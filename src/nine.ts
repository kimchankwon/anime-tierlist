import type { Id } from "../convex/_generated/dataModel";

/**
 * A 3x3 tile as the client holds it. `url` is what to draw — the server fills
 * it in from Convex storage for uploads, and it is a local object URL for the
 * moments between picking a file and the next query round-trip.
 */
export type NineCell = {
  caption: string;
  subtitle: string | null;
  imageId: Id<"_storage"> | null;
  imageUrl: string | null;
  url: string | null;
} | null;

export type NineDoc = {
  _id: Id<"grids">;
  userId: Id<"users">;
  title: string;
  cells: NineCell[];
  updatedAt: number;
  filled: number;
};

export const GRID_SIZE = 9;

/**
 * The server stores a title exactly as typed — except a blank one, which is
 * not written at all, so it never comes back under the caret as
 * "Untitled 3x3". Anywhere a title is displayed rather than edited falls
 * back to this.
 */
export const UNTITLED = "Untitled 3x3";
export const displayTitle = (title: string) => title.trim() || UNTITLED;
export const hasTitle = (title: string) => title.trim().length > 0;

export type SaveState = "idle" | "saving" | "saved" | "unsaved" | "needs-title";

/** Badge next to the title. A blank name wins over idle/saved so a row that
 *  already has "" from before this guard still reads Needs a title. */
export function editorSaveBadge(saveState: SaveState, title: string, filled: number) {
  if (saveState === "saving") return { text: "Saving…", kind: "saving" as const };
  if (!hasTitle(title)) return { text: "Needs a title", kind: "needs-title" as const };
  if (saveState === "saved") return { text: "Saved", kind: "saved" as const };
  if (saveState === "unsaved") return { text: "Not saved", kind: "unsaved" as const };
  return { text: `${filled}/9`, kind: "idle" as const };
}

export function gridDeleteBody(title: string, filled: number) {
  const n = filled === 1 ? "tile" : "tiles";
  return `“${displayTitle(title)}” and its ${filled} ${n} go away for good. This cannot be undone.`;
}

export function tileRemoveBody(caption: string) {
  return `“${caption.trim() || "This tile"}” comes off the 3x3. You can add it again later.`;
}

export const emptyCells = (): NineCell[] =>
  Array.from({ length: GRID_SIZE }, () => null);

/** Drop the display-only `url` so the cells match the mutation validator. */
export function toWire(cells: NineCell[]) {
  return cells.map((cell) =>
    cell === null
      ? null
      : {
          caption: cell.caption,
          ...(cell.subtitle ? { subtitle: cell.subtitle } : {}),
          ...(cell.imageId
            ? { imageId: cell.imageId }
            : cell.imageUrl
              ? { imageUrl: cell.imageUrl }
              : {}),
        },
  );
}

/** Exact compare, `url` included, so a saved grid adopts the server's URLs. */
export function sameCells(a: NineCell[], b: NineCell[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}
