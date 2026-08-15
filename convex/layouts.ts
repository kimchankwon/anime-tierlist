import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { listKind } from "./schema";
import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const DEFAULT_LABELS = ["S", "A", "B", "C", "D", "F"];

function scoreToTier(avg: number): number {
  if (avg >= 8.25) return 0;
  if (avg >= 7.25) return 1;
  if (avg >= 6.25) return 2;
  if (avg >= 5.0) return 3;
  if (avg >= 4.0) return 4;
  return 5;
}

async function catalogKeys(
  ctx: QueryCtx | MutationCtx,
  kind: "protagonist" | "antagonist",
) {
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_list_rank", (q) => q.eq("listKind", kind))
    .collect();
  return rows;
}

function mergeLayout(
  labels: string[],
  tiers: string[][],
  pool: string[],
  catalog: { key: string }[],
) {
  const known = new Set(catalog.map((c) => c.key));
  const placed = new Set<string>();
  const nextTiers = labels.map((_, i) =>
    (tiers[i] ?? []).filter((key) => {
      if (!known.has(key) || placed.has(key)) return false;
      placed.add(key);
      return true;
    }),
  );
  const nextPool = pool.filter((key) => {
    if (!known.has(key) || placed.has(key)) return false;
    placed.add(key);
    return true;
  });
  for (const row of catalog) {
    if (!placed.has(row.key)) nextPool.push(row.key);
  }
  return { labels, tiers: nextTiers, pool: nextPool };
}

function autofill(catalog: { key: string; avg: number }[]) {
  const tiers: string[][] = DEFAULT_LABELS.map(() => []);
  for (const row of catalog) {
    tiers[scoreToTier(row.avg)].push(row.key);
  }
  return { labels: [...DEFAULT_LABELS], tiers, pool: [] as string[] };
}

async function getOrCreateLayout(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: "protagonist" | "antagonist",
) {
  const existing = await ctx.db
    .query("layouts")
    .withIndex("by_user_list", (q) =>
      q.eq("userId", userId).eq("listKind", kind),
    )
    .unique();
  const catalog = await catalogKeys(ctx, kind);
  if (!existing) {
    const fresh = autofill(catalog);
    const id = await ctx.db.insert("layouts", {
      userId,
      listKind: kind,
      ...fresh,
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  }
  const merged = mergeLayout(
    existing.labels,
    existing.tiers,
    existing.pool,
    catalog,
  );
  const changed =
    merged.pool.length !== existing.pool.length ||
    merged.tiers.some((tier, i) => tier.length !== (existing.tiers[i] ?? []).length);
  if (changed) {
    await ctx.db.patch(existing._id, { ...merged, updatedAt: Date.now() });
    return (await ctx.db.get(existing._id))!;
  }
  return existing;
}

function personFromUser(
  user: { name?: string; email?: string; image?: string } | null,
  userId: Id<"users">,
  isMe: boolean,
  updatedAt: number,
) {
  return {
    userId,
    name: user?.name?.trim() || user?.email?.split("@")[0] || "Anonymous",
    image: user?.image ?? null,
    isMe,
    updatedAt,
  };
}

export const listPeople = query({
  args: { listKind },
  handler: async (ctx, { listKind: kind }) => {
    const me = await requireUser(ctx);
    const rows = await ctx.db
      .query("layouts")
      .withIndex("by_listKind", (q) => q.eq("listKind", kind))
      .collect();
    const seen = new Set<string>();
    const people = [];
    for (const row of rows) {
      if (seen.has(row.userId)) continue;
      seen.add(row.userId);
      const user = await ctx.db.get(row.userId);
      people.push(personFromUser(user, row.userId, row.userId === me, row.updatedAt));
    }
    people.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return people;
  },
});

export const getForUser = query({
  args: { listKind, userId: v.id("users") },
  handler: async (ctx, { listKind: kind, userId }) => {
    await requireUser(ctx);
    const existing = await ctx.db
      .query("layouts")
      .withIndex("by_user_list", (q) =>
        q.eq("userId", userId).eq("listKind", kind),
      )
      .unique();
    const catalog = await catalogKeys(ctx, kind);
    const user = await ctx.db.get(userId);
    if (!existing) {
      return {
        labels: [...DEFAULT_LABELS],
        tiers: DEFAULT_LABELS.map(() => [] as string[]),
        pool: catalog.map((c) => c.key),
        exists: false,
        owner: personFromUser(user, userId, false, 0),
      };
    }
    return {
      ...mergeLayout(existing.labels, existing.tiers, existing.pool, catalog),
      exists: true,
      owner: personFromUser(user, userId, false, existing.updatedAt),
    };
  },
});

export const get = query({
  args: { listKind },
  handler: async (ctx, { listKind: kind }) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("layouts")
      .withIndex("by_user_list", (q) =>
        q.eq("userId", userId).eq("listKind", kind),
      )
      .unique();
    const catalog = await catalogKeys(ctx, kind);
    if (!existing) {
      return { ...autofill(catalog), exists: false };
    }
    return { ...mergeLayout(existing.labels, existing.tiers, existing.pool, catalog), exists: true };
  },
});

export const save = mutation({
  args: {
    listKind,
    labels: v.array(v.string()),
    tiers: v.array(v.array(v.string())),
    pool: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (args.labels.length === 0) throw new Error("Need at least one tier");
    if (args.tiers.length !== args.labels.length) {
      throw new Error("tiers must match labels");
    }
    const catalog = await catalogKeys(ctx, args.listKind);
    const merged = mergeLayout(args.labels, args.tiers, args.pool, catalog);
    const existing = await ctx.db
      .query("layouts")
      .withIndex("by_user_list", (q) =>
        q.eq("userId", userId).eq("listKind", args.listKind),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...merged, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("layouts", {
      userId,
      listKind: args.listKind,
      ...merged,
      updatedAt: Date.now(),
    });
  },
});

export const resetToPool = mutation({
  args: { listKind },
  handler: async (ctx, { listKind: kind }) => {
    const userId = await requireUser(ctx);
    const catalog = await catalogKeys(ctx, kind);
    const next = {
      labels: [...DEFAULT_LABELS],
      tiers: DEFAULT_LABELS.map(() => [] as string[]),
      pool: catalog.map((c) => c.key),
    };
    const existing = await ctx.db
      .query("layouts")
      .withIndex("by_user_list", (q) =>
        q.eq("userId", userId).eq("listKind", kind),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...next, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("layouts", {
        userId,
        listKind: kind,
        ...next,
        updatedAt: Date.now(),
      });
    }
  },
});

export const autofillByScore = mutation({
  args: { listKind },
  handler: async (ctx, { listKind: kind }) => {
    const userId = await requireUser(ctx);
    const catalog = await catalogKeys(ctx, kind);
    const next = autofill(catalog);
    const existing = await ctx.db
      .query("layouts")
      .withIndex("by_user_list", (q) =>
        q.eq("userId", userId).eq("listKind", kind),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...next, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("layouts", {
        userId,
        listKind: kind,
        ...next,
        updatedAt: Date.now(),
      });
    }
  },
});

export const ensure = mutation({
  args: { listKind },
  handler: async (ctx, { listKind: kind }) => {
    const userId = await requireUser(ctx);
    const row = await getOrCreateLayout(ctx, userId, kind);
    return {
      labels: row.labels,
      tiers: row.tiers,
      pool: row.pool,
    };
  },
});
