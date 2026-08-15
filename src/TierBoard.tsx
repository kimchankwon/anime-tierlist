import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ListKind } from "./App";

const TIER_COLORS = ["#ff7f7f", "#ffbf7f", "#ffdf7f", "#ffff7f", "#bfff7f", "#7fffff"];

type Character = {
  key: string;
  rank: number;
  name: string;
  anime: string;
  xScore: string;
  pScore: string;
  avg: number;
  soft: boolean;
  imageUrl: string | null;
};

type BoardState = {
  labels: string[];
  tiers: string[][];
  pool: string[];
};

type Placement = Map<string, { zone: number | "pool"; label: string }>;

function placementOf(board: BoardState): Placement {
  const map: Placement = new Map();
  board.labels.forEach((label, i) => {
    for (const key of board.tiers[i] ?? []) map.set(key, { zone: i, label });
  });
  for (const key of board.pool) map.set(key, { zone: "pool", label: "Unranked" });
  return map;
}

export function TierBoard({ listKind }: { listKind: ListKind }) {
  const me = useQuery(api.users.me);
  const people = useQuery(api.layouts.listPeople, { listKind });
  const [viewUserId, setViewUserId] = useState<Id<"users"> | "me">("me");
  const [compare, setCompare] = useState(false);

  const viewingOther = viewUserId !== "me";
  const comparing = compare && viewingOther;

  useEffect(() => {
    setViewUserId("me");
    setCompare(false);
  }, [listKind]);

  const selected = people?.find((p) => p.userId === viewUserId);
  const others = (people ?? []).filter((p) => !p.isMe);

  return (
    <>
      <div className="bar">
        <label className="picker">
          View
          <select
            value={viewUserId}
            onChange={(e) => {
              const next = e.target.value as Id<"users"> | "me";
              setViewUserId(next);
              if (next === "me") setCompare(false);
            }}
          >
            <option value="me">Your list</option>
            {others.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={comparing ? "primary" : undefined}
          disabled={!viewingOther}
          onClick={() => setCompare((v) => !v)}
        >
          {comparing ? "Close compare" : "Compare with mine"}
        </button>
        {others.length === 0 && (
          <span className="hint">No other saved lists yet</span>
        )}
      </div>
      {comparing ? (
        <div className="compare">
          <div className="board-col">
            <h3>{me?.name?.trim() || "You"}</h3>
            <EditableBoard listKind={listKind} vsUserId={viewUserId as Id<"users">} />
          </div>
          <div className="board-col">
            <h3>{selected?.name ?? "Them"}</h3>
            <ReadOnlyBoard
              listKind={listKind}
              userId={viewUserId as Id<"users">}
              vsUserId="me"
            />
          </div>
        </div>
      ) : viewingOther ? (
        <ReadOnlyBoard listKind={listKind} userId={viewUserId as Id<"users">} />
      ) : (
        <EditableBoard listKind={listKind} />
      )}
    </>
  );
}

function EditableBoard({
  listKind,
  vsUserId,
}: {
  listKind: ListKind;
  vsUserId?: Id<"users">;
}) {
  const characters = useQuery(api.characters.listByKind, { listKind });
  const remote = useQuery(api.layouts.get, { listKind });
  const other = useQuery(
    api.layouts.getForUser,
    vsUserId ? { listKind, userId: vsUserId } : "skip",
  );
  const save = useMutation(api.layouts.save);
  const resetToPool = useMutation(api.layouts.resetToPool);
  const autofillByScore = useMutation(api.layouts.autofillByScore);
  const ensure = useMutation(api.layouts.ensure);

  const [board, setBoard] = useState<BoardState | null>(null);
  const [big, setBig] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const dirty = useRef(false);
  const dragKey = useRef<string | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, Character>();
    for (const c of characters ?? []) map.set(c.key, c);
    return map;
  }, [characters]);

  const theirs = useMemo(
    () => (other ? placementOf(other) : undefined),
    [other],
  );

  useEffect(() => {
    if (!remote) return;
    if (!dirty.current) {
      setBoard({
        labels: remote.labels,
        tiers: remote.tiers,
        pool: remote.pool,
      });
    }
  }, [remote]);

  useEffect(() => {
    if (remote && remote.exists === false) {
      void ensure({ listKind });
    }
  }, [remote, ensure, listKind]);

  useEffect(() => {
    if (!board || !dirty.current) return;
    setSaveState("saving");
    const handle = window.setTimeout(() => {
      void save({
        listKind,
        labels: board.labels,
        tiers: board.tiers,
        pool: board.pool,
      })
        .then(() => {
          dirty.current = false;
          setSaveState("saved");
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Could not save";
          showToast(message, true);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [board, listKind, save]);

  function showToast(msg: string, err = false) {
    setToast({ msg, err });
    window.setTimeout(() => setToast(null), 1800);
  }

  function commit(next: BoardState) {
    dirty.current = true;
    setBoard(next);
  }

  function moveTile(key: string, zone: "pool" | number, beforeKey?: string) {
    if (!board) return;
    const nextTiers = board.tiers.map((tier) => tier.filter((k) => k !== key));
    const nextPool = board.pool.filter((k) => k !== key);
    if (zone === "pool") insert(nextPool, key, beforeKey);
    else insert(nextTiers[zone], key, beforeKey);
    commit({ ...board, tiers: nextTiers, pool: nextPool });
  }

  function renameLabel(index: number, value: string) {
    if (!board) return;
    const labels = [...board.labels];
    labels[index] = value.replace(/[~|]/g, "") || "?";
    commit({ ...board, labels });
  }

  if (characters === undefined || remote === undefined || !board) {
    return <div className="loading">Loading board…</div>;
  }

  const diffs = theirs ? countDiffs(placementOf(board), theirs) : 0;

  return (
    <>
      <div className="bar inner">
        <button
          type="button"
          onClick={() => {
            void resetToPool({ listKind }).then(() => {
              dirty.current = false;
              showToast("Reset to pool");
            });
          }}
        >
          Reset to pool
        </button>
        <button
          type="button"
          onClick={() => {
            void autofillByScore({ listKind }).then(() => {
              dirty.current = false;
              showToast("Auto-filled by score");
            });
          }}
        >
          Auto-fill by score
        </button>
        <button type="button" onClick={() => setBig((v) => !v)}>
          Toggle tile size
        </button>
        <span className={`save-state ${saveState}`}>
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : "Your list"}
        </span>
        {theirs ? (
          <span className="hint">
            {diffs === 0 ? "Same placement" : `${diffs} differ`}
          </span>
        ) : (
          <span className="hint">
            Drag tiles into a tier · click a tier letter to rename it
          </span>
        )}
      </div>
      <Board
        board={board}
        byKey={byKey}
        big={big}
        editable
        dragKey={dragKey}
        onMove={moveTile}
        onRename={renameLabel}
        contrast={theirs}
        contrastTitle="them"
      />
      <div className={`toast${toast ? " on" : ""}${toast?.err ? " err" : ""}`}>
        {toast?.msg}
      </div>
    </>
  );
}

function ReadOnlyBoard({
  listKind,
  userId,
  vsUserId,
}: {
  listKind: ListKind;
  userId: Id<"users">;
  vsUserId?: Id<"users"> | "me";
}) {
  const characters = useQuery(api.characters.listByKind, { listKind });
  const remote = useQuery(api.layouts.getForUser, { listKind, userId });
  const mine = useQuery(api.layouts.get, vsUserId === "me" ? { listKind } : "skip");
  const [big, setBig] = useState(false);

  const byKey = useMemo(() => {
    const map = new Map<string, Character>();
    for (const c of characters ?? []) map.set(c.key, c);
    return map;
  }, [characters]);

  const contrast = useMemo(
    () => (mine ? placementOf(mine) : undefined),
    [mine],
  );

  if (characters === undefined || remote === undefined) {
    return <div className="loading">Loading board…</div>;
  }

  const board: BoardState = {
    labels: remote.labels,
    tiers: remote.tiers,
    pool: remote.pool,
  };
  const diffs = contrast ? countDiffs(placementOf(board), contrast) : 0;

  return (
    <>
      <div className="bar inner">
        <button type="button" onClick={() => setBig((v) => !v)}>
          Toggle tile size
        </button>
        <span className="save-state">
          {remote.exists
            ? `${remote.owner.name}'s list`
            : `${remote.owner.name} has not ranked this list`}
        </span>
        {contrast && (
          <span className="hint">
            {diffs === 0 ? "Same placement" : `${diffs} differ`}
          </span>
        )}
      </div>
      <Board
        board={board}
        byKey={byKey}
        big={big}
        contrast={contrast}
        contrastTitle="you"
      />
    </>
  );
}

function countDiffs(a: Placement, b: Placement) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let n = 0;
  for (const key of keys) {
    const left = a.get(key);
    const right = b.get(key);
    if (!left || !right || left.label !== right.label) n += 1;
  }
  return n;
}

function Board({
  board,
  byKey,
  big,
  editable = false,
  dragKey,
  onMove,
  onRename,
  contrast,
  contrastTitle,
}: {
  board: BoardState;
  byKey: Map<string, Character>;
  big: boolean;
  editable?: boolean;
  dragKey?: MutableRefObject<string | null>;
  onMove?: (key: string, zone: "pool" | number, beforeKey?: string) => void;
  onRename?: (index: number, value: string) => void;
  contrast?: Placement;
  contrastTitle?: string;
}) {
  return (
    <main>
      <div>
        {board.labels.map((label, i) => (
          <div className="tier" key={i}>
            {editable && onRename ? (
              <input
                className="label"
                style={{ background: TIER_COLORS[i % TIER_COLORS.length] }}
                value={label}
                spellCheck={false}
                onChange={(e) => onRename(i, e.target.value)}
              />
            ) : (
              <div
                className="label"
                style={{ background: TIER_COLORS[i % TIER_COLORS.length] }}
              >
                {label}
              </div>
            )}
            <DropZone
              zone={i}
              keys={board.tiers[i] ?? []}
              byKey={byKey}
              big={big}
              editable={editable}
              dragKey={dragKey}
              onMove={onMove}
              contrast={contrast}
              contrastTitle={contrastTitle}
            />
          </div>
        ))}
      </div>
      <div className="pool">
        <h2>Unranked</h2>
        <DropZone
          zone="pool"
          keys={board.pool}
          byKey={byKey}
          big={big}
          editable={editable}
          dragKey={dragKey}
          onMove={onMove}
          contrast={contrast}
          contrastTitle={contrastTitle}
        />
      </div>
    </main>
  );
}

function insert(list: string[], key: string, beforeKey?: string) {
  const idx = beforeKey ? list.indexOf(beforeKey) : -1;
  if (idx >= 0) list.splice(idx, 0, key);
  else list.push(key);
}

function DropZone({
  zone,
  keys,
  byKey,
  big,
  editable = false,
  dragKey,
  onMove,
  contrast,
  contrastTitle,
}: {
  zone: "pool" | number;
  keys: string[];
  byKey: Map<string, Character>;
  big: boolean;
  editable?: boolean;
  dragKey?: MutableRefObject<string | null>;
  onMove?: (key: string, zone: "pool" | number, beforeKey?: string) => void;
  contrast?: Placement;
  contrastTitle?: string;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`drop${over ? " over" : ""}`}
      onDragOver={
        editable
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={editable ? () => setOver(false) : undefined}
      onDrop={
        editable && onMove && dragKey
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const key = e.dataTransfer.getData("text/plain") || dragKey.current;
              if (!key) return;
              const after = (e.target as HTMLElement).closest(".tile") as HTMLElement | null;
              onMove(key, zone, after?.dataset.key);
            }
          : undefined
      }
    >
      {keys.map((key) => {
        const item = byKey.get(key);
        if (!item) return null;
        const other = contrast?.get(key);
        const isDiff = Boolean(other && other.zone !== zone);
        return (
          <div
            key={key}
            className={`tile${big ? " big" : ""}${isDiff ? " diff" : ""}${editable ? "" : " locked"}`}
            draggable={editable}
            data-key={key}
            title={
              isDiff && other
                ? `${item.anime}  —  ${item.name}   (${contrastTitle}: ${other.label})`
                : `${item.anime}  —  ${item.name}   (xtectra ${item.xScore} / Prowtar ${item.pScore} — avg ${item.avg})`
            }
            onDragStart={
              editable && dragKey
                ? (e) => {
                    dragKey.current = key;
                    e.dataTransfer.setData("text/plain", key);
                    (e.currentTarget as HTMLElement).classList.add("drag");
                  }
                : undefined
            }
            onDragEnd={
              editable && dragKey
                ? (e) => {
                    (e.currentTarget as HTMLElement).classList.remove("drag");
                    dragKey.current = null;
                  }
                : undefined
            }
          >
            {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : null}
            <span className="rk">#{item.rank}</span>
            {item.soft ? <span className="soft">?</span> : null}
            {isDiff && other ? (
              <span className="vs">
                {contrastTitle} {other.label}
              </span>
            ) : null}
            <span className="cap">{item.name}</span>
          </div>
        );
      })}
    </div>
  );
}
