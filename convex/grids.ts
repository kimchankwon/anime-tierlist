import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { personFromUser } from "./lib/people";
import { GRID_SIZE, gridCell } from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const MAX_TITLE = 80;
const MAX_CAPTION = 80;
const MAX_URL = 2048;
const MAX_GRIDS_PER_USER = 60;

type Cell = Doc<"grids">["cells"][number];

const EMPTY: Cell[] = Array.from({ length: GRID_SIZE }, () => null);

function cleanTitle(title: string) {
  const trimmed = title.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);
  return trimmed || "Untitled 3x3";
}

/** Server-side trim of a whole grid: fixed length, capped text, one image source. */
function cleanCells(cells: Cell[]): Cell[] {
  if (cells.length !== GRID_SIZE) {
    throw new Error(`A 3x3 needs exactly ${GRID_SIZE} cells`);
  }
  return cells.map((cell) => {
    if (!cell) return null;
    const url = cell.imageUrl?.trim();
    if (url && !/^https:\/\//i.test(url)) {
      throw new Error("Image links must start with https://");
    }
    if (url && url.length > MAX_URL) throw new Error("Image link is too long");
    return {
      caption: cell.caption.trim().slice(0, MAX_CAPTION),
      ...(cell.subtitle?.trim()
        ? { subtitle: cell.subtitle.trim().slice(0, MAX_CAPTION) }
        : {}),
      // An uploaded file wins, so a cell never carries two competing pictures.
      ...(cell.imageId ? { imageId: cell.imageId } : url ? { imageUrl: url } : {}),
    };
  });
}

async function resolveGrid(ctx: QueryCtx, row: Doc<"grids">) {
  const cells = await Promise.all(
    row.cells.map(async (cell) => {
      if (!cell) return null;
      return {
        caption: cell.caption,
        subtitle: cell.subtitle ?? null,
        imageId: cell.imageId ?? null,
        imageUrl: cell.imageUrl ?? null,
        url: cell.imageId
          ? await ctx.storage.getUrl(cell.imageId)
          : (cell.imageUrl ?? null),
      };
    }),
  );
  return {
    _id: row._id,
    userId: row.userId,
    title: row.title,
    cells,
    updatedAt: row.updatedAt,
    filled: row.cells.filter(Boolean).length,
  };
}

async function ownedGrid(ctx: MutationCtx, gridId: Id<"grids">) {
  const userId = await requireUser(ctx);
  const row = await ctx.db.get(gridId);
  if (!row) throw new Error("That 3x3 no longer exists");
  if (row.userId !== userId) throw new Error("That 3x3 belongs to someone else");
  return { userId, row };
}

/**
 * Delete uploaded files that `candidates` used and nothing else still points
 * at. Scans every grid, not just the owner's, so a file a second grid shares
 * is never yanked out from under it.
 */
async function pruneImages(
  ctx: MutationCtx,
  candidates: Id<"_storage">[],
  ignoreGridId: Id<"grids">,
) {
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return;
  const all = await ctx.db.query("grids").collect();
  const stillUsed = new Set<string>();
  for (const row of all) {
    if (row._id === ignoreGridId) continue;
    for (const cell of row.cells) {
      if (cell?.imageId) stillUsed.add(cell.imageId);
    }
  }
  for (const id of unique) {
    if (!stillUsed.has(id)) await ctx.storage.delete(id);
  }
}

function imageIdsOf(cells: Cell[]) {
  return cells.flatMap((cell) => (cell?.imageId ? [cell.imageId] : []));
}

function newestFirst(a: { updatedAt: number }, b: { updatedAt: number }) {
  return b.updatedAt - a.updatedAt;
}

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("grids")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const resolved = await Promise.all(rows.map((row) => resolveGrid(ctx, row)));
    return resolved.sort(newestFirst);
  },
});

export const listForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("grids")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const user = await ctx.db.get(userId);
    const resolved = await Promise.all(rows.map((row) => resolveGrid(ctx, row)));
    return {
      owner: personFromUser(user, userId, false, rows[0]?.updatedAt ?? 0),
      grids: resolved.sort(newestFirst),
    };
  },
});

export const listPeople = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const rows = await ctx.db.query("grids").collect();
    const newest = new Map<string, number>();
    for (const row of rows) {
      newest.set(row.userId, Math.max(newest.get(row.userId) ?? 0, row.updatedAt));
    }
    const people = [];
    for (const [userId, updatedAt] of newest) {
      const id = userId as Id<"users">;
      const user = await ctx.db.get(id);
      people.push(personFromUser(user, id, id === me, updatedAt));
    }
    people.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return people;
  },
});

export const create = mutation({
  args: { title: v.optional(v.string()), cells: v.optional(v.array(gridCell)) },
  handler: async (ctx, { title, cells }) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("grids")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existing.length >= MAX_GRIDS_PER_USER) {
      throw new Error(`You can keep up to ${MAX_GRIDS_PER_USER} 3x3s`);
    }
    return await ctx.db.insert("grids", {
      userId,
      title: cleanTitle(title ?? ""),
      cells: cells ? cleanCells(cells) : [...EMPTY],
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    gridId: v.id("grids"),
    title: v.optional(v.string()),
    cells: v.optional(v.array(gridCell)),
  },
  handler: async (ctx, { gridId, title, cells }) => {
    const { row } = await ownedGrid(ctx, gridId);
    const nextCells = cells ? cleanCells(cells) : row.cells;
    await ctx.db.patch(gridId, {
      ...(title === undefined ? {} : { title: cleanTitle(title) }),
      ...(cells ? { cells: nextCells } : {}),
      updatedAt: Date.now(),
    });
    if (cells) {
      const kept = new Set(imageIdsOf(nextCells));
      const dropped = imageIdsOf(row.cells).filter((id) => !kept.has(id));
      await pruneImages(ctx, dropped, gridId);
    }
    return gridId;
  },
});

export const remove = mutation({
  args: { gridId: v.id("grids") },
  handler: async (ctx, { gridId }) => {
    const { row } = await ownedGrid(ctx, gridId);
    await ctx.db.delete(gridId);
    await pruneImages(ctx, imageIdsOf(row.cells), gridId);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
