import { useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { TilePicker } from "./TilePicker";
import { sameCells, toWire, type NineCell, type NineDoc } from "./nine";

export function NineGrids() {
  const people = useQuery(api.grids.listPeople, {});
  const [viewUserId, setViewUserId] = useState<Id<"users"> | "me">("me");
  const others = (people ?? []).filter((p) => !p.isMe);

  return (
    <>
      <div className="bar">
        <label className="picker">
          View
          <select
            value={viewUserId}
            onChange={(e) => setViewUserId(e.target.value as Id<"users"> | "me")}
          >
            <option value="me">Your 3x3s</option>
            {others.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          {others.length === 0
            ? "No one else has saved a 3x3 yet"
            : "Pick a friend to flip through their 3x3s"}
        </span>
      </div>
      {viewUserId === "me" ? (
        <MyGrids />
      ) : (
        <TheirGrids key={viewUserId} userId={viewUserId} />
      )}
    </>
  );
}

function MyGrids() {
  const grids = useQuery(api.grids.listMine, {});
  const create = useMutation(api.grids.create);
  const [selected, setSelected] = useState<Id<"grids"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (grids === undefined) return <div className="loading">Loading your 3x3s…</div>;

  // A deleted grid leaves `selected` dangling, so always fall back to the list.
  const current = grids.find((g) => g._id === selected) ?? grids[0] ?? null;

  function newGrid() {
    setCreating(true);
    setError(null);
    void create({ title: "Untitled 3x3" })
      .then((id) => setSelected(id))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not make a 3x3"),
      )
      .finally(() => setCreating(false));
  }

  return (
    <main className="nine-wrap">
      <aside className="nine-side">
        <div className="nine-side-head">
          <h2>Saved 3x3s</h2>
          <button type="button" className="primary" disabled={creating} onClick={newGrid}>
            {creating ? "Adding…" : "New 3x3"}
          </button>
        </div>
        {error ? <p className="nine-empty err">{error}</p> : null}
        {grids.length === 0 ? (
          <p className="nine-empty">
            Nothing saved yet. Make one, title it, and fill the nine slots with
            anime, characters, or your own pictures.
          </p>
        ) : (
          <ul className="nine-cards">
            {grids.map((g) => (
              <li key={g._id}>
                <button
                  type="button"
                  className={g._id === current?._id ? "nine-card on" : "nine-card"}
                  onClick={() => setSelected(g._id)}
                >
                  <Thumb cells={g.cells} />
                  <span className="nine-card-text">
                    <span className="nine-card-title">{g.title}</span>
                    <span className="nine-card-sub">
                      {g.filled}/9 · {new Date(g.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="nine-main">
        {current ? (
          <GridEditor key={current._id} doc={current} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="nine-blank">Make a 3x3 to get started</div>
        )}
      </section>
    </main>
  );
}

function TheirGrids({ userId }: { userId: Id<"users"> }) {
  const data = useQuery(api.grids.listForUser, { userId });
  const [selected, setSelected] = useState<Id<"grids"> | null>(null);

  if (data === undefined) return <div className="loading">Loading…</div>;
  const current = data.grids.find((g) => g._id === selected) ?? data.grids[0] ?? null;

  return (
    <main className="nine-wrap">
      <aside className="nine-side">
        <div className="nine-side-head">
          <h2>{data.owner.name}’s 3x3s</h2>
        </div>
        {data.grids.length === 0 ? (
          <p className="nine-empty">{data.owner.name} has not saved a 3x3 yet.</p>
        ) : (
          <ul className="nine-cards">
            {data.grids.map((g) => (
              <li key={g._id}>
                <button
                  type="button"
                  className={g._id === current?._id ? "nine-card on" : "nine-card"}
                  onClick={() => setSelected(g._id)}
                >
                  <Thumb cells={g.cells} />
                  <span className="nine-card-text">
                    <span className="nine-card-title">{g.title}</span>
                    <span className="nine-card-sub">
                      {g.filled}/9 · {new Date(g.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="nine-main">
        {current ? (
          <>
            <div className="nine-head">
              <h3 className="nine-title-read">{current.title}</h3>
              <span className="save-state">{data.owner.name}’s 3x3</span>
            </div>
            <NineBoard cells={current.cells} />
          </>
        ) : (
          <div className="nine-blank">Nothing to show</div>
        )}
      </section>
    </main>
  );
}

function Thumb({ cells }: { cells: NineCell[] }) {
  return (
    <span className="nine-thumb">
      {cells.map((cell, i) => (
        <span className="nine-thumb-cell" key={i}>
          {cell?.url ? <img src={cell.url} alt="" loading="lazy" /> : null}
        </span>
      ))}
    </span>
  );
}

function GridEditor({ doc, onDeleted }: { doc: NineDoc; onDeleted: () => void }) {
  const update = useMutation(api.grids.update);
  const remove = useMutation(api.grids.remove);
  const [title, setTitle] = useState(doc.title);
  const [cells, setCells] = useState<NineCell[]>(doc.cells);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  // Same guard the tier board uses: a save ack that lands after a newer edit
  // must not let the stale server copy overwrite what is on screen.
  const rev = useRef(0);
  const savedRev = useRef(0);
  const pendingSave = useRef<number | null>(null);
  // Set once the grid is on its way out. Every queued write for it is dropped
  // rather than left to land on a document that no longer exists.
  const abandoned = useRef(false);
  const dirty = () => rev.current !== savedRev.current;

  useEffect(() => {
    if (dirty()) return;
    setTitle((prev) => (prev === doc.title ? prev : doc.title));
    setCells((prev) => (sameCells(prev, doc.cells) ? prev : doc.cells));
  }, [doc]);

  useEffect(() => {
    if (!dirty() || abandoned.current) return;
    setSaveState("saving");
    const sending = rev.current;
    const handle = window.setTimeout(() => {
      pendingSave.current = null;
      void update({ gridId: doc._id, title, cells: toWire(cells) })
        .then(() => {
          savedRev.current = Math.max(savedRev.current, sending);
          if (!dirty()) setSaveState("saved");
        })
        .catch((err: unknown) => {
          setSaveState("idle");
          showToast(err instanceof Error ? err.message : "Could not save", true);
        });
    }, 400);
    pendingSave.current = handle;
    return () => {
      window.clearTimeout(handle);
      if (pendingSave.current === handle) pendingSave.current = null;
    };
  }, [title, cells, doc._id, update]);

  // Picking another 3x3 in the sidebar unmounts this editor. Without this the
  // debounced save never fires and the last edit — usually the title someone
  // just typed — is gone.
  const latest = useRef({ title, cells });
  latest.current = { title, cells };
  useEffect(() => {
    return () => {
      if (rev.current === savedRev.current || abandoned.current) return;
      void update({
        gridId: doc._id,
        title: latest.current.title,
        cells: toWire(latest.current.cells),
      }).catch(() => {
        // Another tab may have deleted the grid meanwhile. Nothing left to
        // save, and no UI left to report it in.
      });
    };
  }, [doc._id, update]);

  // The picker previews a just-uploaded file with an object URL until the
  // query comes back carrying the stored file's real URL. Revoke each one as
  // soon as no cell points at it, and on unmount, so an afternoon of uploads
  // does not pin every blob in memory for the life of the page.
  const blobUrls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set<string>();
    for (const cell of cells) {
      if (!cell?.url) continue;
      live.add(cell.url);
      if (cell.url.startsWith("blob:")) blobUrls.current.add(cell.url);
    }
    for (const url of blobUrls.current) {
      if (live.has(url)) continue;
      URL.revokeObjectURL(url);
      blobUrls.current.delete(url);
    }
  }, [cells]);
  useEffect(() => {
    const urls = blobUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function showToast(msg: string, err = false) {
    setToast({ msg, err });
    window.setTimeout(() => setToast(null), 1800);
  }

  function commit(next: SetStateAction<NineCell[]>) {
    rev.current += 1;
    setCells(next);
  }

  function editTitle(value: string) {
    rev.current += 1;
    setTitle(value);
  }

  const moveCell = useCallback((from: number, to: number) => {
    if (from === to) return;
    rev.current += 1;
    setCells((prev) => {
      const next = [...prev];
      // Swap, so dropping onto a filled slot trades places and dropping onto
      // an empty one just moves the tile.
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  // Every cell edit derives from the previous state rather than this render's
  // snapshot, so none of them depend on render timing.
  const setCell = (index: number, cell: NineCell) =>
    commit((prev) => prev.map((c, n) => (n === index ? cell : c)));

  const filled = cells.filter(Boolean).length;

  return (
    <>
      <div className="nine-head">
        <input
          className="nine-title"
          value={title}
          maxLength={80}
          spellCheck={false}
          aria-label="3x3 title"
          placeholder="Title this 3x3"
          onChange={(e) => editTitle(e.target.value)}
        />
        <span className={`save-state ${saveState}`}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : `${filled}/9`}
        </span>
        <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>
          Delete
        </button>
      </div>
      <NineBoard
        cells={cells}
        editable
        onMove={moveCell}
        onAdd={(i) => setPickFor(i)}
        onClear={(i) => setCell(i, null)}
        onCaption={(i, caption) =>
          commit((prev) =>
            prev.map((c, n) => (n === i && c ? { ...c, caption } : c)),
          )
        }
      />
      <p className="nine-hint">
        Drag a tile onto another slot to swap them · on a phone, hold a tile to
        pick it up · × clears a slot
      </p>
      {pickFor !== null ? (
        <TilePicker
          onClose={() => setPickFor(null)}
          onPick={(cell) => {
            setCell(pickFor, cell);
            setPickFor(null);
          }}
        />
      ) : null}
      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete this 3x3?"
          body={`“${title}” and its ${filled} ${filled === 1 ? "tile" : "tiles"} go away for good.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            // Drop the queued save and the unmount flush first. Either one
            // landing after the delete would fail on a missing document and
            // surface as a bogus "no longer exists" error.
            abandoned.current = true;
            if (pendingSave.current !== null) {
              window.clearTimeout(pendingSave.current);
              pendingSave.current = null;
            }
            void remove({ gridId: doc._id })
              .then(onDeleted)
              .catch((err: unknown) => {
                abandoned.current = false;
                showToast(err instanceof Error ? err.message : "Could not delete", true);
              });
          }}
        />
      ) : null}
      <div className={`toast${toast ? " on" : ""}${toast?.err ? " err" : ""}`}>{toast?.msg}</div>
    </>
  );
}

const HOLD_MS = 140;
const MOVE_PX = 8;
const SCROLL_PX = 10;
const SETTLE_MS = 180;

type PendingPick = {
  index: number;
  pointerId: number;
  grabX: number;
  grabY: number;
  w: number;
  h: number;
  startX: number;
  startY: number;
  pointerType: string;
};

type DragSession = PendingPick & { x: number; y: number; settling: boolean };

/** Which of the nine slots sits under the pointer, if any. */
function cellIndexAt(x: number, y: number): number | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement)) continue;
    const raw = el.dataset.cell;
    if (raw === undefined) continue;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

function scrollByDelta(dy: number) {
  const el = document.scrollingElement ?? document.documentElement;
  el.scrollTop -= dy;
}

function NineBoard({
  cells,
  editable = false,
  onMove,
  onAdd,
  onClear,
  onCaption,
}: {
  cells: NineCell[];
  editable?: boolean;
  onMove?: (from: number, to: number) => void;
  onAdd?: (index: number) => void;
  onClear?: (index: number) => void;
  onCaption?: (index: number, caption: string) => void;
}) {
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const pendingRef = useRef<PendingPick | null>(null);
  const scrollRef = useRef<{ pointerId: number; lastY: number } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const liveRef = useRef(true);
  const dragRef = useRef<DragSession | null>(null);
  const overRef = useRef<number | null>(null);
  const onMoveRef = useRef(onMove);
  dragRef.current = drag;
  overRef.current = over;
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
    overRef.current = pending.index;
    setDrag(next);
    setOver(pending.index);
    document.body.classList.add("dragging");
    if (pending.pointerType === "touch") navigator.vibrate?.(10);
  }, []);

  const cancelPending = useCallback(() => {
    pendingRef.current = null;
    clearHold();
  }, []);

  /** Glide the ghost into the slot it will land in, then apply the swap. */
  const settleOrCommit = useCallback((target: number | null) => {
    const session = dragRef.current;
    if (!session || session.settling) return;

    const finish = (to: number | null) => {
      document.body.classList.remove("dragging");
      dragRef.current = null;
      overRef.current = null;
      if (!liveRef.current) return;
      if (to !== null && to !== session.index) onMoveRef.current?.(session.index, to);
      setDrag(null);
      setOver(null);
    };

    if (target === null || target === session.index) {
      finish(null);
      return;
    }
    const dest = document
      .querySelector<HTMLElement>(`.n-cell[data-cell="${target}"]`)
      ?.getBoundingClientRect();
    if (!dest) {
      finish(target);
      return;
    }
    const settled: DragSession = { ...session, settling: true, x: dest.left, y: dest.top };
    dragRef.current = settled;
    setDrag(settled);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      finish(target);
    }, SETTLE_MS);
  }, []);

  useEffect(() => {
    if (!editable) return;
    liveRef.current = true;

    const onMovePtr = (e: PointerEvent) => {
      const scrolling = scrollRef.current;
      if (scrolling && e.pointerId === scrolling.pointerId) {
        scrollByDelta(e.clientY - scrolling.lastY);
        scrolling.lastY = e.clientY;
        return;
      }

      const pending = pendingRef.current;
      if (pending && e.pointerId === pending.pointerId) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        const dist = Math.hypot(dx, dy);
        // A vertical swipe before the hold fires is the page scrolling, not a
        // pick-up — the slots set touch-action: none, so drive it by hand.
        if (pending.pointerType === "touch" && dist > SCROLL_PX && Math.abs(dy) > Math.abs(dx)) {
          cancelPending();
          scrollRef.current = { pointerId: e.pointerId, lastY: e.clientY };
          scrollByDelta(dy);
          return;
        }
        if (dist > MOVE_PX) activate(pending, e.clientX, e.clientY);
        return;
      }

      const session = dragRef.current;
      if (!session || session.settling || e.pointerId !== session.pointerId) return;
      e.preventDefault();
      session.x = e.clientX - session.grabX;
      session.y = e.clientY - session.grabY;
      const ghostEl = document.querySelector<HTMLElement>(".n-ghost");
      if (ghostEl && !ghostEl.classList.contains("settling")) {
        ghostEl.style.left = `${session.x}px`;
        ghostEl.style.top = `${session.y}px`;
      }
      const hit = cellIndexAt(e.clientX, e.clientY);
      if (hit !== overRef.current) {
        overRef.current = hit;
        setOver(hit);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (scrollRef.current?.pointerId === e.pointerId) {
        scrollRef.current = null;
        return;
      }
      const pending = pendingRef.current;
      if (pending && e.pointerId === pending.pointerId) {
        cancelPending();
        return;
      }
      const session = dragRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      settleOrCommit(cellIndexAt(e.clientX, e.clientY) ?? overRef.current);
    };

    const onCancel = (e: PointerEvent) => {
      if (scrollRef.current?.pointerId === e.pointerId) {
        scrollRef.current = null;
        return;
      }
      const pending = pendingRef.current;
      if (pending && e.pointerId === pending.pointerId) {
        cancelPending();
        return;
      }
      const session = dragRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      // pointerup already kicked off the drop animation — a trailing cancel
      // on some browsers must not abort it.
      if (session.settling || settleTimer.current !== null) return;
      settleOrCommit(null);
    };

    const blockScroll = (ev: TouchEvent) => {
      if (dragRef.current && !dragRef.current.settling) ev.preventDefault();
    };

    window.addEventListener("pointermove", onMovePtr);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", blockScroll, { passive: false });
    return () => {
      liveRef.current = false;
      clearHold();
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
      pendingRef.current = null;
      scrollRef.current = null;
      dragRef.current = null;
      overRef.current = null;
      window.removeEventListener("pointermove", onMovePtr);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", blockScroll);
      document.body.classList.remove("dragging");
    };
  }, [activate, cancelPending, editable, settleOrCommit]);

  const onPick = useCallback(
    (e: ReactPointerEvent<HTMLElement>, index: number) => {
      if (!editable || e.button !== 0 || dragRef.current) return;
      // The × and the caption box live inside the tile; let them have the tap.
      if ((e.target as HTMLElement).closest("input, button, textarea")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pending: PendingPick = {
        index,
        pointerId: e.pointerId,
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        w: rect.width,
        h: rect.height,
        startX: e.clientX,
        startY: e.clientY,
        pointerType: e.pointerType,
      };
      pendingRef.current = pending;
      clearHold();
      if (e.pointerType === "touch") {
        holdTimer.current = window.setTimeout(
          () => activate(pending, pending.startX, pending.startY),
          HOLD_MS,
        );
      }
    },
    [activate, editable],
  );

  const dragged = drag ? cells[drag.index] : null;
  const ghost =
    drag && dragged
      ? createPortal(
          <div
            className={`n-cell n-ghost${drag.settling ? " settling" : ""}`}
            style={{ width: drag.w, height: drag.h, left: drag.x, top: drag.y }}
          >
            {dragged.url ? <img src={dragged.url} alt="" draggable={false} /> : null}
            <span className="n-cap-read">{dragged.caption}</span>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className={`nine-grid${editable ? "" : " locked"}`}>
        {cells.map((cell, i) => {
          const isSource = drag?.index === i;
          const isTarget = drag !== null && over === i && over !== drag.index;
          const classes = [
            "n-cell",
            cell ? "filled" : "empty",
            isSource ? "lifted" : "",
            isTarget ? "target" : "",
          ]
            .filter(Boolean)
            .join(" ");

          if (!cell) {
            return editable ? (
              <button
                type="button"
                key={i}
                className={classes}
                data-cell={i}
                onClick={() => onAdd?.(i)}
              >
                <span className="n-plus">+</span>
                <span className="n-add">Add</span>
              </button>
            ) : (
              <div key={i} className={classes} data-cell={i} />
            );
          }

          return (
            <div
              key={i}
              className={classes}
              data-cell={i}
              title={cell.subtitle ? `${cell.caption} — ${cell.subtitle}` : cell.caption}
              onPointerDown={editable ? (e) => onPick(e, i) : undefined}
              onContextMenu={editable ? (e) => e.preventDefault() : undefined}
            >
              {cell.url ? (
                <img src={cell.url} alt={cell.caption} draggable={false} />
              ) : (
                <span className="n-noimg">No picture</span>
              )}
              {editable ? (
                <>
                  <button
                    type="button"
                    className="n-x"
                    aria-label={`Remove ${cell.caption || "tile"}`}
                    onClick={() => onClear?.(i)}
                  >
                    ×
                  </button>
                  <input
                    className="n-cap"
                    value={cell.caption}
                    maxLength={80}
                    placeholder="Caption"
                    aria-label="Caption"
                    onChange={(e) => onCaption?.(i, e.target.value)}
                  />
                </>
              ) : (
                <span className="n-cap-read">{cell.caption}</span>
              )}
            </div>
          );
        })}
      </div>
      {ghost}
    </>
  );
}
