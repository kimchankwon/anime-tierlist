import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { personFromUser } from "./lib/people";
import { GRID_SIZE, gridCell } from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const MAX_TITLE = 80;
const MAX_CAPTION = 80;
const MAX_URL = 2048;
const MAX_GRIDS_PER_USER = 60;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type Cell = Doc<"grids">["cells"][number];

const EMPTY: Cell[] = Array.from({ length: GRID_SIZE }, () => null);

export const UNTITLED = "Untitled 3x3";

// Length is the only thing enforced on text the user is actively typing.
// Trimming or collapsing whitespace here would come straight back through the
// editor's sync effect and rewrite the field mid-keystroke: a trailing space
// in "Attack on " vanished, and the next keystrokes produced "Attack onTitan".
// A blank title is rejected rather than rewritten to "Untitled 3x3", for the
// same reason: substituting it would land in the box the next time the query
// caught up.
function capText(text: string, max: number) {
  return text.slice(0, max);
}

function requireTitle(title: string) {
  const next = capText(title, MAX_TITLE);
  if (!next.trim()) throw new Error("Give this 3x3 a title");
  return next;
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
      caption: capText(cell.caption, MAX_CAPTION),
      ...(cell.subtitle
        ? { subtitle: capText(cell.subtitle, MAX_CAPTION) }
        : {}),
      // An uploaded file wins, so a cell never carries two competing pictures.
      ...(cell.imageId ? { imageId: cell.imageId } : url ? { imageUrl: url } : {}),
    };
  });
}

/**
 * The URL `generateUploadUrl` hands out enforces nothing about what gets
 * POSTed to it, and the picker's own type and size checks are client-side, so
 * trivially skipped. Re-check here, where a file first becomes part of a grid.
 */
async function assertUsableUploads(ctx: MutationCtx, cells: Cell[]) {
  for (const cell of cells) {
    if (!cell?.imageId) continue;
    const meta = await ctx.db.system.get(cell.imageId);
    if (!meta) throw new Error("That upload is no longer available");
    if (!meta.contentType?.startsWith("image/")) {
      throw new Error("Tiles have to be images");
    }
    if (meta.size > MAX_UPLOAD_BYTES) {
      throw new Error("Images have to be under 8 MB");
    }
  }
}

/**
 * `mine` controls whether storage ids come back. The owner's editor round-trips
 * them on save, but a read-only viewer only ever draws `url` — handing them out
 * would let anyone pin someone else's file into their own grid, after which the
 * owner could never reclaim it by clearing the tile.
 */
async function resolveGrid(ctx: QueryCtx, row: Doc<"grids">, mine: boolean) {
  const cells = await Promise.all(
    row.cells.map(async (cell) => {
      if (!cell) return null;
      return {
        caption: cell.caption,
        subtitle: cell.subtitle ?? null,
        imageId: mine ? (cell.imageId ?? null) : null,
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
  // The seeded catalog shares this bucket. Nothing today can put a character's
  // storage id into a cell — it is never sent to the client — but if anything
  // ever does, deleting that grid would take the shared art with it. The sweep
  // already guards this; the two delete paths should not disagree.
  for (const row of await ctx.db.query("characters").collect()) {
    if (row.imageId) stillUsed.add(row.imageId);
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
    const resolved = await Promise.all(
      rows.map((row) => resolveGrid(ctx, row, true)),
    );
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
    const resolved = await Promise.all(
      rows.map((row) => resolveGrid(ctx, row, false)),
    );
    return {
      owner: personFromUser(
        user,
        userId,
        false,
        // by_user is creation order, so rows[0] is the oldest, not the latest.
        rows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0),
      ),
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
    const nextCells = cells ? cleanCells(cells) : [...EMPTY];
    await assertUsableUploads(ctx, nextCells);
    return await ctx.db.insert("grids", {
      userId,
      title: title === undefined ? UNTITLED : requireTitle(title),
      cells: nextCells,
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
    if (cells) await assertUsableUploads(ctx, nextCells);
    await ctx.db.patch(gridId, {
      ...(title === undefined ? {} : { title: requireTitle(title) }),
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

// A file only becomes reachable once a grid points at it, and the server never
// learns the storage id until the client sends it back — so an upload that is
// never referenced (a failed save, a closed tab, a client that just skips the
// mutation) leaves an object nothing can reach. Sweep those instead of trying
// to track pending uploads, which a client can simply decline to report.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export const sweepOrphanedUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Gather every reference BEFORE deleting anything: if a read throws or a
    // table is missed, the mutation aborts having deleted nothing.
    const referenced = new Set<string>();
    for (const row of await ctx.db.query("grids").collect()) {
      for (const cell of row.cells) {
        if (cell?.imageId) referenced.add(cell.imageId);
      }
    }
    // The seeded character art lives in the same bucket. Missing these would
    // wipe the catalog's images, so they are collected the same way.
    for (const row of await ctx.db.query("characters").collect()) {
      if (row.imageId) referenced.add(row.imageId);
    }

    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    const files = await ctx.db.system.query("_storage").collect();
    let deleted = 0;
    for (const file of files) {
      // The grace period keeps a file that was uploaded moments ago and has
      // not been saved into a grid yet.
      if (file._creationTime >= cutoff) continue;
      if (referenced.has(file._id)) continue;
      await ctx.storage.delete(file._id);
      deleted += 1;
    }
    return { scanned: files.length, referenced: referenced.size, deleted };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
