import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBOUNCE_MS, searchCache } from "./pickerSearch";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

import { TilePicker } from "./TilePicker";

function animePayload(
  shows: { id: number; title: string; year?: number; cover?: string | null }[],
) {
  return {
    data: {
      Page: {
        media: shows.map((s) => ({
          id: s.id,
          seasonYear: s.year ?? null,
          title: { english: s.title, romaji: s.title },
          coverImage:
            s.cover === null
              ? { extraLarge: null, large: null }
              : { extraLarge: s.cover ?? `https://img.example/${s.id}.jpg`, large: null },
        })),
      },
    },
  };
}

function characterPayload(
  chars: { id: number; name: string; show?: string; image?: string | null }[],
) {
  return {
    data: {
      Page: {
        characters: chars.map((c) => ({
          id: c.id,
          name: { full: c.name },
          image: c.image === null ? { large: null } : { large: c.image ?? `https://img.example/c${c.id}.jpg` },
          media: {
            nodes: c.show ? [{ title: { english: c.show, romaji: c.show } }] : [],
          },
        })),
      },
    },
  };
}

function ok(json: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  });
}

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  });
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
}

describe("TilePicker", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    searchCache.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not hit AniList for a 1-character query", async () => {
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("n");
    await flushDebounce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Art comes from AniList")).toBeTruthy();
  });

  it("debounces so rapid typing fires one request with the last term", async () => {
    fetchMock.mockImplementation(() => ok(animePayload([{ id: 1, title: "Naruto", year: 2002 }])));
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("na");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    typeQuery("nar");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    typeQuery("naruto");
    expect(fetchMock).not.toHaveBeenCalled();
    await flushDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.variables.q).toBe("naruto");
    expect(screen.getByText("Naruto")).toBeTruthy();
    expect(screen.getByText("2002")).toBeTruthy();
  });

  it("filters last results immediately while the next request is still debounced", async () => {
    fetchMock.mockImplementation((_: string, init: RequestInit) => {
      const q = JSON.parse(init.body as string).variables.q as string;
      if (q === "naru") {
        return ok(
          animePayload([
            { id: 1, title: "Naruto", year: 2002 },
            { id: 2, title: "Naruto Shippuden", year: 2007 },
          ]),
        );
      }
      return ok(animePayload([{ id: 2, title: "Naruto Shippuden", year: 2007 }]));
    });
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("naru");
    await flushDebounce();
    expect(screen.getByText("Naruto")).toBeTruthy();
    expect(screen.getByText("Naruto Shippuden")).toBeTruthy();

    typeQuery("ship");
    expect(screen.queryByText("Naruto")).toBeNull();
    expect(screen.getByText("Naruto Shippuden")).toBeTruthy();
    expect(screen.getByText("Updating results…")).toBeTruthy();
    expect(document.querySelector(".picker-results.stale")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flushDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".picker-results.stale")).toBeNull();
  });

  it("serves a repeat query from cache without a second network call", async () => {
    fetchMock.mockImplementation(() => ok(animePayload([{ id: 1, title: "Naruto" }])));
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("naruto");
    await flushDebounce();
    typeQuery("");
    typeQuery("naruto");
    await flushDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Naruto")).toBeTruthy();
  });

  it("keeps the upload file input enabled after leaving a search mid-flight", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          const signal = init.signal;
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          setTimeout(() => resolve(ok(animePayload([{ id: 1, title: "Naruto" }])) as Awaited<ReturnType<typeof ok>>), 5000);
        }),
    );
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("na");
    fireEvent.click(screen.getByRole("button", { name: "Your own" }));
    const file = screen.getByLabelText("Upload a picture") as HTMLInputElement;
    expect(file.disabled).toBe(false);
    expect(screen.getByText("Anything you upload stays in your own 3x3s")).toBeTruthy();
    expect(screen.queryByText("Uploading…")).toBeNull();
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("does not paint a late aborted response over a newer query", async () => {
    let resolveSlow: ((value: unknown) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
            resolveSlow = resolve;
          }),
      )
      .mockImplementationOnce(() => ok(animePayload([{ id: 2, title: "One Piece" }])));

    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("na");
    await flushDebounce();
    typeQuery("one");
    await act(async () => {
      resolveSlow?.(ok(animePayload([{ id: 1, title: "SHOULD NOT APPEAR" }])));
      await Promise.resolve();
    });
    await flushDebounce();
    expect(screen.queryByText("SHOULD NOT APPEAR")).toBeNull();
    expect(screen.getByText("One Piece")).toBeTruthy();
  });

  it("drops rows without art and reports a confirmed empty search", async () => {
    fetchMock.mockImplementation(() =>
      ok(animePayload([{ id: 1, title: "No Art", cover: null }])),
    );
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("zz");
    await flushDebounce();
    expect(screen.getByText("Nothing found")).toBeTruthy();
    expect(screen.queryByText("No Art")).toBeNull();
  });

  it("surfaces AniList 429s without wiping the previous hits", async () => {
    fetchMock
      .mockImplementationOnce(() => ok(animePayload([{ id: 1, title: "Naruto" }])))
      .mockImplementationOnce(() => ok({}, 429));
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("na");
    await flushDebounce();
    expect(screen.getByText("Naruto")).toBeTruthy();
    typeQuery("nan");
    await flushDebounce();
    expect(screen.getByText("AniList is rate-limiting — try again in a moment")).toBeTruthy();
    expect(screen.getByText("Naruto")).toBeTruthy();
  });

  it("searches characters on that tab and never shows leftover anime rows", async () => {
    fetchMock.mockImplementation((_: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (String(body.query).includes("characters")) {
        return ok(characterPayload([{ id: 9, name: "Monkey D. Luffy", show: "One Piece" }]));
      }
      return ok(animePayload([{ id: 1, title: "Naruto" }]));
    });
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    typeQuery("na");
    await flushDebounce();
    expect(screen.getByText("Naruto")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.queryByText("Naruto")).toBeNull();
    await flushDebounce();
    expect(screen.getByText("Monkey D. Luffy")).toBeTruthy();
    expect(screen.getByText("One Piece")).toBeTruthy();
  });

  it("picks a result with the AniList image as both imageUrl and url", async () => {
    fetchMock.mockImplementation(() =>
      ok(animePayload([{ id: 1, title: "Naruto", year: 2002, cover: "https://img.example/naruto.jpg" }])),
    );
    const onPick = vi.fn();
    render(<TilePicker onPick={onPick} onClose={() => {}} />);
    typeQuery("na");
    await flushDebounce();
    fireEvent.click(screen.getByRole("button", { name: /Naruto/ }));
    expect(onPick).toHaveBeenCalledWith({
      caption: "Naruto",
      subtitle: "2002",
      imageId: null,
      imageUrl: "https://img.example/naruto.jpg",
      url: "https://img.example/naruto.jpg",
    });
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<TilePicker onPick={() => {}} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-https image link", () => {
    render(<TilePicker onPick={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Your own" }));
    fireEvent.change(screen.getByPlaceholderText("https://…"), {
      target: { value: "http://insecure.example/x.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    expect(screen.getByText("Image links have to start with https://")).toBeTruthy();
  });
});
