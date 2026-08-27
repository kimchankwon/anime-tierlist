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
