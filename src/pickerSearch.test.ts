import { describe, expect, it } from "vitest";
import {
  isAbortError,
  MAX_CACHE,
  needsNetwork,
  pickerStatus,
  rowMatches,
  SearchCache,
  selectVisible,
  type Suggestion,
} from "./pickerSearch";

const row = (
  caption: string,
  extra: Partial<Suggestion> = {},
): Suggestion => ({
  id: extra.id ?? caption,
  caption,
  subtitle: extra.subtitle ?? null,
  imageUrl: extra.imageUrl ?? "https://img.example/x.jpg",
});

describe("SearchCache", () => {
  it("misses until set, then hits case-insensitively and ignoring surrounding space", () => {
    const cache = new SearchCache();
    expect(cache.get("anime", "naruto")).toBeUndefined();
    const rows = [row("Naruto")];
    cache.set("anime", "Naruto", rows);
    expect(cache.get("anime", "naruto")).toBe(rows);
    expect(cache.get("anime", " NARUTO ")).toBe(rows);
    expect(cache.get("character", "naruto")).toBeUndefined();
  });

  it("stores empty results as a real hit so we do not refetch a known miss", () => {
    const cache = new SearchCache();
    cache.set("anime", "zzzz", []);
    expect(cache.get("anime", "zzzz")).toEqual([]);
    expect(needsNetwork("anime", "zzzz", cache)).toBe(false);
  });

  it("evicts the oldest entry once it is over capacity", () => {
    const cache = new SearchCache(3);
    cache.set("anime", "a", [row("A")]);
    cache.set("anime", "b", [row("B")]);
    cache.set("anime", "c", [row("C")]);
    cache.set("anime", "d", [row("D")]);
    expect(cache.size).toBe(3);
    expect(cache.get("anime", "a")).toBeUndefined();
    expect(cache.get("anime", "b")?.[0].caption).toBe("B");
    expect(cache.get("anime", "d")?.[0].caption).toBe("D");
  });

  it("treats a rewrite as most-recent so it is not the next eviction", () => {
    const cache = new SearchCache(2);
    cache.set("anime", "a", [row("A")]);
    cache.set("anime", "b", [row("B")]);
    cache.set("anime", "a", [row("A2")]);
    cache.set("anime", "c", [row("C")]);
    expect(cache.get("anime", "a")?.[0].caption).toBe("A2");
    expect(cache.get("anime", "b")).toBeUndefined();
  });

  it("caps at MAX_CACHE by default", () => {
    const cache = new SearchCache();
    for (let i = 0; i < MAX_CACHE + 5; i++) cache.set("anime", `q${i}`, []);
    expect(cache.size).toBe(MAX_CACHE);
  });
});

describe("rowMatches", () => {
  it("matches caption or subtitle, case-insensitive", () => {
    const n = row("Monkey D. Luffy", { subtitle: "One Piece" });
    expect(rowMatches(n, "luffy")).toBe(true);
    expect(rowMatches(n, "ONE")).toBe(true);
    expect(rowMatches(n, "naruto")).toBe(false);
  });

  it("treats a blank term as matching everything", () => {
    expect(rowMatches(row("Naruto"), "   ")).toBe(true);
  });
});

describe("needsNetwork", () => {
  it("skips own mode, short queries, and cache hits", () => {
    const cache = new SearchCache();
    expect(needsNetwork("own", "naruto", cache)).toBe(false);
    expect(needsNetwork("anime", "n", cache)).toBe(false);
    expect(needsNetwork("anime", "  n  ", cache)).toBe(false);
    expect(needsNetwork("anime", "na", cache)).toBe(true);
    cache.set("anime", "na", [row("Naruto")]);
    expect(needsNetwork("anime", "na", cache)).toBe(false);
    expect(needsNetwork("character", "na", cache)).toBe(true);
  });
});

describe("selectVisible", () => {
  const naruto = row("Naruto", { subtitle: "2002" });
  const shippuden = row("Naruto Shippuden", { subtitle: "2007" });
  const luffy = row("Monkey D. Luffy", { subtitle: "One Piece" });

  it("is empty for own mode and for queries under 2 characters", () => {
    const cache = new SearchCache();
    expect(selectVisible("own", "naruto", null, cache)).toEqual({
      rows: [],
      confirmed: true,
      stale: false,
    });
    expect(selectVisible("anime", "n", null, cache).rows).toEqual([]);
    expect(selectVisible("anime", " n ", null, cache).stale).toBe(false);
  });

  it("renders a cache hit immediately, including an empty one", () => {
    const cache = new SearchCache();
    cache.set("anime", "naruto", [naruto]);
    const hit = selectVisible("anime", "Naruto", null, cache);
    expect(hit).toEqual({ rows: [naruto], confirmed: true, stale: false });
    cache.set("anime", "zzzz", []);
    expect(selectVisible("anime", "zzzz", null, cache)).toEqual({
      rows: [],
      confirmed: true,
      stale: false,
    });
  });

  it("prefers cache over a stale fetched result for a different term", () => {
    const cache = new SearchCache();
    cache.set("anime", "luffy", [luffy]);
    const view = selectVisible(
      "anime",
      "luffy",
      { mode: "anime", term: "naruto", rows: [naruto] },
      cache,
    );
    expect(view.rows).toEqual([luffy]);
    expect(view.confirmed).toBe(true);
  });

  it("filters the last same-mode result while a new query is in flight", () => {
    const cache = new SearchCache();
    const fetched = { mode: "anime" as const, term: "naru", rows: [naruto, shippuden] };
    const view = selectVisible("anime", "ship", fetched, cache);
    expect(view.rows).toEqual([shippuden]);
    expect(view.stale).toBe(true);
    expect(view.confirmed).toBe(false);
  });

  it("keeps the previous rows when nothing in them matches the new query", () => {
    const cache = new SearchCache();
    const fetched = { mode: "anime" as const, term: "naruto", rows: [naruto] };
    const view = selectVisible("anime", "one piece", fetched, cache);
    expect(view.rows).toEqual([naruto]);
    expect(view.stale).toBe(true);
  });

  it("does not show anime rows under the character tab", () => {
    const cache = new SearchCache();
    const fetched = { mode: "anime" as const, term: "luffy", rows: [naruto] };
    const view = selectVisible("character", "luffy", fetched, cache);
    expect(view.rows).toEqual([]);
    expect(view.stale).toBe(true);
  });

  it("treats a fetched result for this exact term as confirmed", () => {
    const cache = new SearchCache();
    const fetched = { mode: "anime" as const, term: "naruto", rows: [naruto] };
    const view = selectVisible("anime", "naruto", fetched, cache);
    expect(view).toEqual({ rows: [naruto], confirmed: true, stale: false });
  });
});

describe("pickerStatus", () => {
  const base = {
    mode: "anime" as const,
    term: "na",
    searching: false,
    uploading: false,
    error: null,
    visibleCount: 2,
    confirmed: true,
    stale: false,
  };

  it("ranks uploading, searching, then errors above idle copy", () => {
    expect(pickerStatus({ ...base, uploading: true }).text).toBe("Uploading…");
    expect(pickerStatus({ ...base, searching: true }).text).toBe("Searching…");
    expect(pickerStatus({ ...base, error: "AniList is rate-limiting — try again in a moment" })).toEqual({
      text: "AniList is rate-limiting — try again in a moment",
      err: true,
    });
  });

  it("says nothing found only once the query is confirmed empty", () => {
    expect(
      pickerStatus({ ...base, visibleCount: 0, confirmed: true, stale: false }),
    ).toEqual({ text: "Nothing found", err: true });
    expect(
      pickerStatus({
        ...base,
        visibleCount: 0,
        confirmed: false,
        stale: true,
      }).text,
    ).toBe("Updating results…");
  });

  it("does not claim nothing found for a short query or the upload tab", () => {
    expect(pickerStatus({ ...base, term: "n", visibleCount: 0 }).text).toBe(
      "Art comes from AniList",
    );
    expect(
      pickerStatus({ ...base, mode: "own", visibleCount: 0 }).text,
    ).toMatch(/upload/);
  });

  it("keeps searching above a leftover error so a retry does not look failed", () => {
    expect(
      pickerStatus({ ...base, searching: true, error: "Search failed" }).text,
    ).toBe("Searching…");
  });
});

describe("isAbortError", () => {
  it("accepts a signal, a DOMException, or an Error named AbortError", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(new Error("nope"), controller.signal)).toBe(true);
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
    expect(isAbortError(new Error("Search failed"))).toBe(false);
  });
});
