import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadCharacterImage } from "./fetch-character-images.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "data", "characters.json");
const additions = JSON.parse(readFileSync(join(root, "data", "additions.json"), "utf8"));
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

const existing = new Set(catalog.map((c) => `${c.listKind}:${c.name.toLowerCase()}:${c.anime.toLowerCase()}`));
const nextRank = {
  protagonist: Math.max(0, ...catalog.filter((c) => c.listKind === "protagonist").map((c) => c.rank)),
  antagonist: Math.max(0, ...catalog.filter((c) => c.listKind === "antagonist").map((c) => c.rank)),
};

let added = 0;
let skipped = 0;
for (const item of additions.characters) {
  const sig = `${item.listKind}:${item.name.toLowerCase()}:${item.anime.toLowerCase()}`;
  if (existing.has(sig)) {
    skipped += 1;
    continue;
  }
  let imageFile;
  try {
    imageFile = await downloadCharacterImage(item.listKind, item.name, item.search ?? item.name);
  } catch (err) {
    console.error(`FAIL ${item.listKind} ${item.name}: ${err.message}`);
    continue;
  }
  nextRank[item.listKind] += 1;
  catalog.push({
    key: `${item.listKind}-${nextRank[item.listKind]}`,
    listKind: item.listKind,
    rank: nextRank[item.listKind],
    name: item.name,
    anime: item.anime,
    xScore: item.xScore,
    pScore: item.pScore,
    avg: item.avg,
    soft: Boolean(item.soft),
    imageFile,
  });
  existing.add(sig);
  added += 1;
  console.log(`added ${item.listKind} ${item.name} (${item.anime}) -> ${imageFile}`);
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
console.log(`done. added=${added} skipped=${skipped} total=${catalog.length}`);
