import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const listKind = v.union(
  v.literal("protagonist"),
  v.literal("antagonist"),
);

export const GRID_SIZE = 9;

// One tile of a 3x3. The picture is either an outside URL (AniList art) or a
// file the user uploaded into Convex storage — never both.
export const gridCell = v.union(
  v.null(),
  v.object({
    caption: v.string(),
    subtitle: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
  }),
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
  })
    .index("by_user_list", ["userId", "listKind"])
    .index("by_listKind", ["listKind"]),

  // A 3x3 collage. `cells` is always nine entries in reading order; an empty
  // slot is null so a hole in the middle of the grid survives a save.
  grids: defineTable({
    userId: v.id("users"),
    title: v.string(),
    cells: v.array(gridCell),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"]),
});
