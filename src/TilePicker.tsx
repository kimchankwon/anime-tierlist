import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { NineCell } from "./nine";
import {
  DEBOUNCE_MS,
  isAbortError,
  needsNetwork,
  pickerStatus,
  searchCache,
  selectVisible,
  type Fetched,
  type PickerMode,
  type Suggestion,
} from "./pickerSearch";

const ANILIST = "https://graphql.anilist.co";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ANIME_QUERY = `query ($q: String!) {
  Page(perPage: 24) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
      id
      seasonYear
      title { romaji english }
      coverImage { extraLarge large }
    }
  }
}`;

const CHARACTER_QUERY = `query ($q: String!) {
  Page(perPage: 24) {
    characters(search: $q, sort: SEARCH_MATCH) {
      id
      name { full }
      image { large }
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji english } } }
    }
  }
}`;

type AniListTitle = { romaji?: string | null; english?: string | null };

async function anilist(query: string, q: string, signal: AbortSignal) {
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { q } }),
    signal,
  });
  if (res.status === 429) throw new Error("AniList is rate-limiting — try again in a moment");
  if (!res.ok) throw new Error(`AniList search failed (${res.status})`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message ?? "Search failed");
  return json.data;
}

function titleOf(t: AniListTitle | null | undefined) {
  return t?.english?.trim() || t?.romaji?.trim() || "Untitled";
}

async function searchAnime(q: string, signal: AbortSignal): Promise<Suggestion[]> {
  const data = await anilist(ANIME_QUERY, q, signal);
  return (data?.Page?.media ?? [])
    .filter((m: any) => m?.coverImage?.extraLarge || m?.coverImage?.large)
    .map((m: any) => ({
      id: `anime-${m.id}`,
      caption: titleOf(m.title),
      subtitle: m.seasonYear ? String(m.seasonYear) : null,
      imageUrl: m.coverImage.extraLarge ?? m.coverImage.large,
    }));
}

async function searchCharacters(q: string, signal: AbortSignal): Promise<Suggestion[]> {
  const data = await anilist(CHARACTER_QUERY, q, signal);
  return (data?.Page?.characters ?? [])
    .filter((c: any) => c?.image?.large)
    .map((c: any) => ({
      id: `char-${c.id}`,
      caption: c.name?.full?.trim() || "Unknown",
      subtitle: c.media?.nodes?.[0] ? titleOf(c.media.nodes[0].title) : null,
      imageUrl: c.image.large,
    }));
}

export function TilePicker({
  onPick,
  onClose,
}: {
  onPick: (cell: NonNullable<NineCell>) => void;
  onClose: () => void;
}) {
  const generateUploadUrl = useMutation(api.grids.generateUploadUrl);
  const [mode, setMode] = useState<PickerMode>("anime");
  const [q, setQ] = useState("");
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [linkCaption, setLinkCaption] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  const term = q.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFn.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (mode !== "own") searchRef.current?.focus();
  }, [mode]);

  // AniList 429s if we fire on every keystroke, so the network call waits
  // until typing pauses. The grid itself does not wait: a cache hit renders
  // immediately, otherwise the last result stays up (filtered to the new
  // query when anything still matches) so the picker never blanks out
  // between letters. Searching and uploading are separate flags because
  // aborting a search used to leave the upload panel on a frozen
  // "Uploading…" with the file input disabled.
  const view = useMemo(
    () => selectVisible(mode, term, fetched, searchCache),
    [mode, term, fetched],
  );
  const { rows: visible, confirmed, stale } = view;
  const status = pickerStatus({
    mode,
    term,
    searching,
    uploading,
    error,
    visibleCount: visible.length,
    confirmed,
    stale,
  });

  useEffect(() => {
    if (!needsNetwork(mode, term, searchCache)) {
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(false);
    setError(null);
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      setSearching(true);
      const run = mode === "anime" ? searchAnime : searchCharacters;
      run(term, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          searchCache.set(mode, term, rows);
          setFetched({ mode, term, rows });
        })
        .catch((err: unknown) => {
          if (isAbortError(err, controller.signal)) return;
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [mode, term]);

  async function uploadFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Images have to be under 8 MB");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      onPick({
        caption: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
        subtitle: null,
        imageId: storageId,
        imageUrl: null,
        // Shown until the next query resolves the stored file's real URL.
        url: URL.createObjectURL(file),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function addLink() {
    const trimmed = link.trim();
    if (!/^https:\/\//i.test(trimmed)) {
      setError("Image links have to start with https://");
      return;
    }
    onPick({
      caption: linkCaption.trim().slice(0, 80),
      subtitle: null,
      imageId: null,
      imageUrl: trimmed,
      url: trimmed,
    });
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal picker-modal" role="dialog" aria-modal="true" aria-label="Add a tile">
        <div className="picker-tabs">
          <button
            type="button"
            className={mode === "anime" ? "tab active" : "tab"}
            onClick={() => setMode("anime")}
          >
            Anime
          </button>
          <button
            type="button"
            className={mode === "character" ? "tab active" : "tab"}
            onClick={() => setMode("character")}
          >
            Characters
          </button>
          <button
            type="button"
            className={mode === "own" ? "tab active" : "tab"}
            onClick={() => setMode("own")}
          >
            Your own
          </button>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {mode === "own" ? (
          <div className="picker-own">
            <label className="field">
              <span>Upload a picture</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadFile(file);
                }}
              />
            </label>
            <div className="picker-or">or</div>
            <label className="field">
              <span>Paste an image link</span>
              <input
                type="url"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Caption</span>
              <input
                type="text"
                placeholder="What is it?"
                maxLength={80}
                value={linkCaption}
                onChange={(e) => setLinkCaption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addLink();
                }}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="primary" disabled={!link.trim()} onClick={addLink}>
                Add tile
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              ref={searchRef}
              className="picker-search"
              type="search"
              placeholder={mode === "anime" ? "Search anime…" : "Search characters…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div
              className={`picker-results${stale ? " stale" : ""}`}
              aria-busy={searching}
            >
              {visible.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className="picker-hit"
                  onClick={() =>
                    onPick({
                      caption: row.caption,
                      subtitle: row.subtitle,
                      imageId: null,
                      imageUrl: row.imageUrl,
                      url: row.imageUrl,
                    })
                  }
                >
                  <img src={row.imageUrl} alt="" loading="lazy" />
                  <span className="picker-hit-name">{row.caption}</span>
                  {row.subtitle ? (
                    <span className="picker-hit-sub">{row.subtitle}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </>
        )}
        <div className={`picker-status${status.err ? " err" : ""}`}>{status.text}</div>
      </div>
    </div>
  );
}
