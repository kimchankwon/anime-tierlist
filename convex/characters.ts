import { query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { listKind } from "./schema";

export const listByKind = query({
  args: { listKind },
  handler: async (ctx, { listKind: kind }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("characters")
      .withIndex("by_list_rank", (q) => q.eq("listKind", kind))
      .collect();
    return await Promise.all(
      rows.map(async (row) => ({
        key: row.key,
        listKind: row.listKind,
        rank: row.rank,
        name: row.name,
        anime: row.anime,
        xScore: row.xScore,
        pScore: row.pScore,
        avg: row.avg,
        soft: row.soft,
        imageUrl: row.imageId ? await ctx.storage.getUrl(row.imageId) : null,
      })),
    );
  },
});
