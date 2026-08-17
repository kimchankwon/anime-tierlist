import { useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ListKind } from "./App";
import {
  dropIntentAt,
  nextKeyIn,
  wouldMove,
  zoneOf,
  type DropIntent,
  type ZoneId,
} from "./pointerDrag";

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

// countDiffs() compares tier labels, so the per-tile highlight has to as well.
// Comparing zone indexes instead made a renamed tier read as "21 differ" with
// nothing highlighted.
function sameSlot(
  mine: { label: string } | undefined,
  zoneLabel: string,
) {
  return mine !== undefined && mine.label === zoneLabel;
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
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Bumped on every local edit. `savedRev` is the revision the last successful
  // save wrote. The board is only clean when the two agree, so a save ack that
  // lands after a newer drag cannot let the (now stale) server copy overwrite it.
  const rev = useRef(0);
  const savedRev = useRef(0);
  const pendingSave = useRef<number | null>(null);
  const dirty = () => rev.current !== savedRev.current;

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
    if (!dirty()) {
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
    if (!board || !dirty()) return;
    setSaveState("saving");
    const sending = rev.current;
    const handle = window.setTimeout(() => {
      pendingSave.current = null;
      void save({
        listKind,
        labels: board.labels,
        tiers: board.tiers,
        pool: board.pool,
      })
        .then(() => {
          savedRev.current = Math.max(savedRev.current, sending);
          if (!dirty()) setSaveState("saved");
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Could not save";
          showToast(message, true);
        });
    }, 250);
    pendingSave.current = handle;
    return () => {
      window.clearTimeout(handle);
      if (pendingSave.current === handle) pendingSave.current = null;
    };
  }, [board, listKind, save]);

  function showToast(msg: string, err = false) {
    setToast({ msg, err });
    window.setTimeout(() => setToast(null), 1800);
  }

  function commit(next: BoardState) {
    rev.current += 1;
    setBoard(next);
  }

  // resetToPool and autofillByScore rewrite the whole layout on the server. A
  // debounced save left armed would fire afterwards and write the pre-bulk
  // board back over it, so cancel it first. `startedAt` is the revision the
  // bulk replaces: on success only that revision is marked saved, so an edit
  // made mid-flight still gets its own save. On failure the cancelled save is
  // re-armed rather than dropped.
  function runBulk(
    op: () => Promise<unknown>,
    okMsg: string,
    failMsg: string,
  ) {
    const cancelled = pendingSave.current;
    if (cancelled !== null) {
      window.clearTimeout(cancelled);
      pendingSave.current = null;
    }
    const startedAt = rev.current;
    setSaveState("saving");
    void op()
      .then(() => {
        savedRev.current = Math.max(savedRev.current, startedAt);
        if (!dirty()) setSaveState("saved");
        showToast(okMsg);
      })
      .catch((err: unknown) => {
        setSaveState("idle");
        showToast(err instanceof Error ? err.message : failMsg, true);
        // Re-arm the save we cancelled so the local edit is not lost.
        if (cancelled !== null) {
          rev.current += 1;
          setBoard((prev) => (prev ? { ...prev } : prev));
        }
      });
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
  const ranked = board.tiers.reduce((n, tier) => n + tier.length, 0);

  return (
    <>
      <div className="bar inner">
        <button type="button" onClick={() => setConfirmingReset(true)}>
          Reset to pool
        </button>
        <button
          type="button"
          onClick={() =>
            runBulk(
              () => autofillByScore({ listKind }),
              "Auto-filled by score",
              "Could not auto-fill",
            )
          }
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
            Drag tiles into a tier · on a phone, hold a tile to pick it up
          </span>
        )}
      </div>
      <Board
        board={board}
        byKey={byKey}
        big={big}
        editable
        onMove={moveTile}
        onRename={renameLabel}
        contrast={theirs}
        contrastTitle="them"
      />
      {confirmingReset ? (
        <ConfirmDialog
          title="Are you sure?"
          body={`This clears every tier and puts all ${ranked} ${
            ranked === 1 ? "tile" : "tiles"
          } back in Unranked. It cannot be undone.`}
          confirmLabel="Reset to pool"
          onCancel={() => setConfirmingReset(false)}
          onConfirm={() => {
            setConfirmingReset(false);
            runBulk(
              () => resetToPool({ listKind }),
              "Reset to pool",
              "Could not reset",
            );
          }}
        />
      ) : null}
      <div className={`toast${toast ? " on" : ""}${toast?.err ? " err" : ""}`}>
        {toast?.msg}
      </div>
    </>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Kept in a ref so re-renders never re-run the effect and steal focus back.
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelFn.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h3 id="confirm-title">{title}</h3>
        <p id="confirm-body">{body}</p>
        <div className="modal-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
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

const HOLD_MS = 140;
const MOVE_PX = 8;
const SCROLL_PX = 10;
const SETTLE_MS = 180;

type PendingPick = {
  key: string;
  pointerId: number;
  grabX: number;
  grabY: number;
  w: number;
  h: number;
  startX: number;
  startY: number;
  pointerType: string;
  origin: DropIntent;
};

type DragSession = PendingPick & {
  x: number;
  y: number;
  settling: boolean;
};

function Board({
  board,
  byKey,
  big,
  editable = false,
  onMove,
  onRename,
  contrast,
  contrastTitle,
}: {
  board: BoardState;
  byKey: Map<string, Character>;
  big: boolean;
  editable?: boolean;
  onMove?: (key: string, zone: ZoneId, beforeKey?: string) => void;
  onRename?: (index: number, value: string) => void;
  contrast?: Placement;
  contrastTitle?: string;
}) {
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [hover, setHover] = useState<DropIntent | null>(null);
  const pendingRef = useRef<PendingPick | null>(null);
  const holdTimer = useRef<number | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const hoverRef = useRef<DropIntent | null>(null);
  const boardRef = useRef(board);
  const onMoveRef = useRef(onMove);
  dragRef.current = drag;
  hoverRef.current = hover;
  boardRef.current = board;
  onMoveRef.current = onMove;

  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const activate = useCallback((pending: PendingPick, clientX: number, clientY: number) => {
    if (pendingRef.current !== pending) return;
    pendingRef.current = null;
    clearHold();
    const next: DragSession = {
      ...pending,
      x: clientX - pending.grabX,
      y: clientY - pending.grabY,
      settling: false,
    };
    dragRef.current = next;
    hoverRef.current = pending.origin;
    setDrag(next);
    setHover(pending.origin);
    document.body.classList.add("dragging");
    if (pending.pointerType === "touch") navigator.vibrate?.(10);
  }, []);

  const cancelPending = useCallback(() => {
    pendingRef.current = null;
    clearHold();
  }, []);

  const settleOrCommit = useCallback((intent: DropIntent | null) => {
    const session = dragRef.current;
    if (!session || session.settling) return;
    const boardNow = boardRef.current;
    const commit = (target: DropIntent | null) => {
      document.body.classList.remove("dragging");
      if (
        target &&
        wouldMove(boardNow.tiers, boardNow.pool, session.key, target)
      ) {
        onMoveRef.current?.(session.key, target.zone, target.beforeKey);
      }
      dragRef.current = null;
      hoverRef.current = null;
      setDrag(null);
      setHover(null);
    };

    if (!intent) {
      commit(null);
      return;
    }

    hoverRef.current = intent;
    setHover(intent);
    // Two frames so React can paint the landing slot before we measure it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ph = document.querySelector<HTMLElement>(".tile.ph");
        const dest = ph?.getBoundingClientRect();
        if (!dest) {
          commit(intent);
          return;
        }
        const settled: DragSession = {
          ...session,
          settling: true,
          x: dest.left,
          y: dest.top,
        };
        dragRef.current = settled;
        setDrag(settled);
        window.setTimeout(() => commit(intent), SETTLE_MS);
      });
    });
  }, []);

  useEffect(() => {
    if (!editable) return;

    const onMovePtr = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && e.pointerId === pending.pointerId) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        const dist = Math.hypot(dx, dy);
        if (
          pending.pointerType === "touch" &&
          dist > SCROLL_PX &&
          Math.abs(dy) > Math.abs(dx)
        ) {
          cancelPending();
          return;
        }
        if (dist > MOVE_PX) activate(pending, e.clientX, e.clientY);
        return;
      }

      const session = dragRef.current;
      if (!session || session.settling || e.pointerId !== session.pointerId) {
        return;
      }
      e.preventDefault();
      session.x = e.clientX - session.grabX;
      session.y = e.clientY - session.grabY;
      const ghostEl = document.querySelector<HTMLElement>(".tile-ghost");
      if (ghostEl && !ghostEl.classList.contains("settling")) {
        ghostEl.style.left = `${session.x}px`;
        ghostEl.style.top = `${session.y}px`;
      }
      const intent = dropIntentAt(e.clientX, e.clientY, session.key);
      if (
        intent &&
        (hoverRef.current?.zone !== intent.zone ||
          hoverRef.current?.beforeKey !== intent.beforeKey)
      ) {
        hoverRef.current = intent;
        setHover(intent);
      }
    };

    const onUp = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && e.pointerId === pending.pointerId) {
        cancelPending();
        return;
      }
      const session = dragRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      const intent =
        dropIntentAt(e.clientX, e.clientY, session.key) ?? hoverRef.current;
      settleOrCommit(intent);
    };

    const blockScroll = (e: TouchEvent) => {
      if (dragRef.current && !dragRef.current.settling) e.preventDefault();
    };

    window.addEventListener("pointermove", onMovePtr);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", blockScroll, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMovePtr);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", blockScroll);
      document.body.classList.remove("dragging");
    };
  }, [activate, cancelPending, editable, settleOrCommit]);

  const onPick = useCallback(
    (e: ReactPointerEvent<HTMLElement>, key: string) => {
      if (!editable || e.button !== 0 || dragRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = zoneOf(board.tiers, key);
      const list = zone === "pool" ? board.pool : (board.tiers[zone] ?? []);
      const pending: PendingPick = {
        key,
        pointerId: e.pointerId,
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        w: rect.width,
        h: rect.height,
        startX: e.clientX,
        startY: e.clientY,
        pointerType: e.pointerType,
        origin: { zone, beforeKey: nextKeyIn(list, key) },
      };
      pendingRef.current = pending;
      clearHold();
      if (e.pointerType === "touch") {
        holdTimer.current = window.setTimeout(
          () => activate(pending, pending.startX, pending.startY),
          HOLD_MS
        );
      }
    },
    [activate, board.pool, board.tiers, editable]
  );

  const ghostItem = drag ? byKey.get(drag.key) : undefined;
  const ghost =
    drag && ghostItem
      ? createPortal(
          <div
            className={`tile tile-ghost${big ? " big" : ""}${drag.settling ? " settling" : ""}`}
            style={{
              width: drag.w,
              height: drag.h,
              left: drag.x,
              top: drag.y,
            }}
          >
            <TileFace item={ghostItem} />
          </div>,
          document.body
        )
      : null;

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
              zoneLabel={label}
              keys={board.tiers[i] ?? []}
              byKey={byKey}
              big={big}
              editable={editable}
              dragKey={drag?.key ?? null}
              hover={hover}
              tileSize={drag ? { w: drag.w, h: drag.h } : null}
              onPick={onPick}
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
          zoneLabel="Unranked"
          keys={board.pool}
          byKey={byKey}
          big={big}
          editable={editable}
          dragKey={drag?.key ?? null}
          hover={hover}
          tileSize={drag ? { w: drag.w, h: drag.h } : null}
          onPick={onPick}
          contrast={contrast}
          contrastTitle={contrastTitle}
        />
      </div>
      {ghost}
    </main>
  );
}

function insert(list: string[], key: string, beforeKey?: string) {
  const idx = beforeKey ? list.indexOf(beforeKey) : -1;
  if (idx >= 0) list.splice(idx, 0, key);
  else list.push(key);
}

function TileFace({
  item,
  other,
  contrastTitle,
}: {
  item: Character;
  other?: { label: string };
  contrastTitle?: string;
}) {
  return (
    <>
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.name} draggable={false} />
      ) : null}
      <span className="rk">#{item.rank}</span>
      {item.soft ? <span className="soft">?</span> : null}
      {other ? (
        <span className="vs">
          {contrastTitle} {other.label}
        </span>
      ) : null}
      <span className="cap">{item.name}</span>
    </>
  );
}

function DropZone({
  zone,
  zoneLabel,
  keys,
  byKey,
  big,
  editable = false,
  dragKey,
  hover,
  tileSize,
  onPick,
  contrast,
  contrastTitle,
}: {
  zone: ZoneId;
  zoneLabel: string;
  keys: string[];
  byKey: Map<string, Character>;
  big: boolean;
  editable?: boolean;
  dragKey: string | null;
  hover: DropIntent | null;
  tileSize: { w: number; h: number } | null;
  onPick: (e: ReactPointerEvent<HTMLElement>, key: string) => void;
  contrast?: Placement;
  contrastTitle?: string;
}) {
  const visible = dragKey ? keys.filter((k) => k !== dragKey) : keys;
  const showPh = Boolean(dragKey && hover && hover.zone === zone);
  const phAt = showPh
    ? hover!.beforeKey
      ? visible.indexOf(hover!.beforeKey)
      : visible.length
    : -1;
  const insertAt = phAt < 0 ? visible.length : phAt;

  const cells: Array<{ type: "tile"; key: string } | { type: "ph" }> = [];
  visible.forEach((key, i) => {
    if (i === insertAt && showPh) cells.push({ type: "ph" });
    cells.push({ type: "tile", key });
  });
  if (showPh && insertAt >= visible.length) cells.push({ type: "ph" });

  return (
    <div
      className={`drop${showPh ? " over" : ""}`}
      data-zone={String(zone)}
    >
      {cells.map((cell) => {
        if (cell.type === "ph") {
          return (
            <div
              key="ph"
              className={`tile ph${big ? " big" : ""}`}
              style={
                tileSize
                  ? { width: tileSize.w, height: tileSize.h }
                  : undefined
              }
            />
          );
        }
        const item = byKey.get(cell.key);
        if (!item) return null;
        const other = contrast?.get(cell.key);
        const isDiff = Boolean(other) && !sameSlot(other, zoneLabel);
        return (
          <div
            key={cell.key}
            className={`tile${big ? " big" : ""}${isDiff ? " diff" : ""}${editable ? "" : " locked"}`}
            data-key={cell.key}
            title={
              isDiff && other
                ? `${item.anime}  —  ${item.name}   (${contrastTitle}: ${other.label})`
                : `${item.anime}  —  ${item.name}   (xtectra ${item.xScore} / Prowtar ${item.pScore} — avg ${item.avg})`
            }
            onPointerDown={
              editable ? (e) => onPick(e, cell.key) : undefined
            }
            onContextMenu={
              editable ? (e) => e.preventDefault() : undefined
            }
          >
            <TileFace
              item={item}
              other={isDiff ? other : undefined}
              contrastTitle={contrastTitle}
            />
          </div>
        );
      })}
    </div>
  );
}
