import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { api } from "../convex/_generated/api";
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

export function TierBoard({ listKind }: { listKind: ListKind }) {
  const characters = useQuery(api.characters.listByKind, { listKind });
  const remote = useQuery(api.layouts.get, { listKind });
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

  useEffect(() => {
    if (!remote) return;
    if (!dirty.current) setBoard(remote);
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
      void save({ listKind, ...board })
        .then(() => {
          dirty.current = false;
          setSaveState("saved");
        })
        .catch(() => showToast("Could not save", true));
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
    if (zone === "pool") {
      insert(nextPool, key, beforeKey);
    } else {
      insert(nextTiers[zone], key, beforeKey);
    }
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

  return (
    <>
      <div className="bar">
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
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Your list"}
        </span>
        <span className="hint">
          Drag tiles into a tier · click a tier letter to rename it
        </span>
      </div>
      <main>
        <div>
          {board.labels.map((label, i) => (
            <div className="tier" key={i}>
              <input
                className="label"
                style={{ background: TIER_COLORS[i % TIER_COLORS.length] }}
                value={label}
                spellCheck={false}
                onChange={(e) => renameLabel(i, e.target.value)}
              />
              <DropZone
                zone={i}
                keys={board.tiers[i] ?? []}
                byKey={byKey}
                big={big}
                dragKey={dragKey}
                onMove={moveTile}
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
            dragKey={dragKey}
            onMove={moveTile}
          />
        </div>
      </main>
      <div className={`toast${toast ? " on" : ""}${toast?.err ? " err" : ""}`}>
        {toast?.msg}
      </div>
    </>
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
  dragKey,
  onMove,
}: {
  zone: "pool" | number;
  keys: string[];
  byKey: Map<string, Character>;
  big: boolean;
  dragKey: MutableRefObject<string | null>;
  onMove: (key: string, zone: "pool" | number, beforeKey?: string) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`drop${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const key = e.dataTransfer.getData("text/plain") || dragKey.current;
        if (!key) return;
        const after = (e.target as HTMLElement).closest(".tile") as HTMLElement | null;
        onMove(key, zone, after?.dataset.key);
      }}
    >
      {keys.map((key) => {
        const item = byKey.get(key);
        if (!item) return null;
        return (
          <div
            key={key}
            className={`tile${big ? " big" : ""}`}
            draggable
            data-key={key}
            title={`${item.anime}  —  ${item.name}   (xtectra ${item.xScore} / Prowtar ${item.pScore} — avg ${item.avg})`}
            onDragStart={(e) => {
              dragKey.current = key;
              e.dataTransfer.setData("text/plain", key);
              (e.currentTarget as HTMLElement).classList.add("drag");
            }}
            onDragEnd={(e) => {
              (e.currentTarget as HTMLElement).classList.remove("drag");
              dragKey.current = null;
            }}
          >
            {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : null}
            <span className="rk">#{item.rank}</span>
            {item.soft ? <span className="soft">?</span> : null}
            <span className="cap">{item.name}</span>
          </div>
        );
      })}
    </div>
  );
}
