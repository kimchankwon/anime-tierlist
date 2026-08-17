export type ZoneId = "pool" | number;

export type DropIntent = {
  zone: ZoneId;
  beforeKey?: string;
};

type TileBox = { key: string; rect: DOMRectReadOnly };

/** First tile that should sit after the pointer — wrap-aware, nearest slot. */
export function insertBeforeKey(
  tiles: TileBox[],
  x: number,
  y: number,
  draggedKey: string
): string | undefined {
  for (const tile of tiles) {
    if (tile.key === draggedKey) continue;
    const midX = tile.rect.left + tile.rect.width / 2;
    if (y < tile.rect.top) return tile.key;
    if (y < tile.rect.bottom && x < midX) return tile.key;
  }
  return undefined;
}

export function parseZone(value: string | undefined): ZoneId | null {
  if (value === undefined) return null;
  if (value === "pool") return "pool";
  if (/^\d+$/.test(value)) return Number(value);
  return null;
}

/** Hit-test the board: which zone and which insert slot is under (x, y). */
export function dropIntentAt(
  x: number,
  y: number,
  draggedKey: string
): DropIntent | null {
  const stack = document.elementsFromPoint(x, y);
  const drop = stack.find(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.classList.contains("drop")
  );
  if (!drop) return null;
  const zone = parseZone(drop.dataset.zone);
  if (zone === null) return null;
  const tiles: TileBox[] = [];
  for (const el of drop.querySelectorAll<HTMLElement>(".tile[data-key]")) {
    if (el.classList.contains("ph") || el.classList.contains("tile-ghost")) {
      continue;
    }
    const key = el.dataset.key;
    if (!key) continue;
    tiles.push({ key, rect: el.getBoundingClientRect() });
  }
  return { zone, beforeKey: insertBeforeKey(tiles, x, y, draggedKey) };
}

export function nextKeyIn(list: string[], key: string): string | undefined {
  const i = list.indexOf(key);
  return i >= 0 ? list[i + 1] : undefined;
}

export function zoneOf(tiers: string[][], key: string): ZoneId {
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i]?.includes(key)) return i;
  }
  return "pool";
}

/** True if moving `key` to `intent` would change the board. */
export function wouldMove(
  tiers: string[][],
  pool: string[],
  key: string,
  intent: DropIntent
): boolean {
  const dest =
    intent.zone === "pool" ? pool.filter((k) => k !== key) : (tiers[intent.zone] ?? []).filter((k) => k !== key);
  const destIdx = intent.beforeKey ? dest.indexOf(intent.beforeKey) : dest.length;
  const insertAt = destIdx >= 0 ? destIdx : dest.length;

  const zone = zoneOf(tiers, key);
  const src = zone === "pool" ? pool : (tiers[zone] ?? []);
  const srcIdx = src.indexOf(key);
  return !(zone === intent.zone && srcIdx === insertAt);
}
