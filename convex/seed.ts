import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { listKind } from "./schema";

function assertSeed(secret: string) {
  const expected = process.env.SEED_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized seed");
  }
}

export const generateUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertSeed(secret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const upsertCharacter = mutation({
  args: {
    secret: v.string(),
    key: v.string(),
    listKind,
    rank: v.number(),
    name: v.string(),
    anime: v.string(),
    xScore: v.string(),
    pScore: v.string(),
    avg: v.number(),
    soft: v.boolean(),
    imageFile: v.string(),
    imageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { secret, ...data }) => {
    assertSeed(secret);
    const existing = await ctx.db
      .query("characters")
      .withIndex("by_key", (q) => q.eq("key", data.key))
      .unique();
    if (existing) {
      if (
        existing.imageId &&
        data.imageId &&
        existing.imageId !== data.imageId
      ) {
        await ctx.storage.delete(existing.imageId);
      }
      await ctx.db.patch(existing._id, {
        ...data,
        imageId: data.imageId ?? existing.imageId,
      });
      return existing._id;
    }
    return await ctx.db.insert("characters", data);
  },
});

export const listSeeded = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertSeed(secret);
    const rows = await ctx.db.query("characters").collect();
    return rows.map((row) => ({
      key: row.key,
      imageFile: row.imageFile,
      hasImage: !!row.imageId,
    }));
  },
});
