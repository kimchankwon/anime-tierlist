export const DEBOUNCE_MS = 320;
export const MAX_CACHE = 48;

export type PickerMode = "anime" | "character" | "own";

export type Suggestion = {
  id: string;
  caption: string;
  subtitle: string | null;
  imageUrl: string;
};

export type Fetched = {
  mode: PickerMode;
  term: string;
  rows: Suggestion[];
};

export type VisibleSearch = {
  rows: Suggestion[];
  confirmed: boolean;
  stale: boolean;
};

function cacheKey(mode: PickerMode, term: string) {
  return `${mode}:${term.trim().toLowerCase()}`;
}

/** LRU of AniList hits. Get is pure so it is safe to read during render. */
export class SearchCache {
  private map = new Map<string, Suggestion[]>();

  constructor(private readonly max = MAX_CACHE) {}

  get(mode: PickerMode, term: string): Suggestion[] | undefined {
    return this.map.get(cacheKey(mode, term));
  }

  set(mode: PickerMode, term: string, rows: Suggestion[]) {
    const k = cacheKey(mode, term);
    this.map.delete(k);
    this.map.set(k, rows);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export const searchCache = new SearchCache();

export function rowMatches(row: Suggestion, term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (
    row.caption.toLowerCase().includes(t) ||
    (row.subtitle !== null && row.subtitle.toLowerCase().includes(t))
  );
}

export function needsNetwork(
  mode: PickerMode,
  term: string,
  cache: SearchCache = searchCache,
) {
  return mode !== "own" && term.trim().length >= 2 && cache.get(mode, term) === undefined;
}

/**
 * What the result grid should show *right now*, before the network comes back.
 * A cache hit is authoritative. Otherwise keep the last same-mode result,
 * filtered to the new query when anything still matches, so typing never
 * blanks the grid.
 */
export function selectVisible(
  mode: PickerMode,
  term: string,
  fetched: Fetched | null,
  cache: SearchCache = searchCache,
): VisibleSearch {
  const trimmed = term.trim();
  if (mode === "own" || trimmed.length < 2) {
    return { rows: [], confirmed: true, stale: false };
  }
  const cached = cache.get(mode, trimmed);
  if (cached !== undefined) {
    return { rows: cached, confirmed: true, stale: false };
  }
  const confirmed =
    fetched !== null && fetched.mode === mode && fetched.term === trimmed;
  if (confirmed) {
    return { rows: fetched.rows, confirmed: true, stale: false };
  }
  if (fetched && fetched.mode === mode) {
    const filtered = fetched.rows.filter((row) => rowMatches(row, trimmed));
    return {
      rows: filtered.length > 0 ? filtered : fetched.rows,
      confirmed: false,
      stale: true,
    };
  }
  return { rows: [], confirmed: false, stale: true };
}

export function isAbortError(err: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return err instanceof Error && err.name === "AbortError";
}

export function pickerStatus(args: {
  mode: PickerMode;
  term: string;
  searching: boolean;
  uploading: boolean;
  error: string | null;
  visibleCount: number;
  confirmed: boolean;
  stale: boolean;
}): { text: string; err: boolean } {
  const { mode, term, searching, uploading, error, visibleCount, confirmed, stale } =
    args;
  if (uploading) return { text: "Uploading…", err: false };
  if (searching) return { text: "Searching…", err: false };
  if (error) return { text: error, err: true };
  const nothing =
    mode !== "own" &&
    term.trim().length >= 2 &&
    confirmed &&
    visibleCount === 0;
  if (nothing) return { text: "Nothing found", err: true };
  if (mode === "own") {
    return { text: "Anything you upload stays in your own 3x3s", err: false };
  }
  if (stale) return { text: "Updating results…", err: false };
  return { text: "Art comes from AniList", err: false };
}
