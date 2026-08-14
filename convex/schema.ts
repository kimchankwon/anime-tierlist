import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const listKind = v.union(
  v.literal("protagonist"),
  v.literal("antagonist"),
);

export default defineSchema({
  ...authTables,

  characters: defineTable({
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
  })
    .index("by_key", ["key"])
    .index("by_list", ["listKind"])
    .index("by_list_rank", ["listKind", "rank"]),

  layouts: defineTable({
    userId: v.id("users"),
    listKind,
    labels: v.array(v.string()),
    // One array of character keys per label, in display order.
    tiers: v.array(v.array(v.string())),
    pool: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_user_list", ["userId", "listKind"]),
});
