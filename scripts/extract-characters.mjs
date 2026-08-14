import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const downloads = join(process.env.USERPROFILE ?? process.env.HOME ?? "", "Downloads");

const sources = [
  {
    listKind: "protagonist",
    html: join(
      downloads,
      "Protagonist Tier List (Top 100 Shared)",
      "Protagonist Tier List (Top 100 Shared).html",
    ),
    imagesDir: join(root, "seed-assets", "protagonist"),
  },
  {
    listKind: "antagonist",
    html: join(
      downloads,
      "Antagonist Tier List (Shared Top 200)",
      "Antagonist Tier List (Shared Top 200).html",
    ),
    imagesDir: join(root, "seed-assets", "antagonist"),
  },
];

function slugPart(name) {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function pickImage(listKind, item, files) {
  if (listKind === "protagonist") {
    const prefix = String(item.rank).padStart(3, "0") + "_";
    const hit = files.find((f) => f.startsWith(prefix));
    if (hit) return hit;
  }
  const wanted = [
    slugPart(item.char),
    slugPart(item.char.split(" ")[0]),
    slugPart(item.char.replace(/^Aura.*/, "Aura")),
    slugPart(item.char.replace(/^Petelgeuse.*/, "Petelgeuse")),
    slugPart(item.char.replace(/^L Lawliet$/, "L-Lawliet")),
  ];
  for (const stem of wanted) {
    const hit = files.find(
      (f) => f.replace(/\.[^.]+$/, "").toLowerCase() === stem.toLowerCase(),
    );
    if (hit) return hit;
  }
  throw new Error(`No image for ${listKind} ${item.rank} ${item.char}`);
}

const characters = [];
for (const source of sources) {
  const html = readFileSync(source.html, "utf8");
  const match = html.match(/const ITEMS = (\[[\s\S]*?\]);/);
  if (!match) throw new Error(`ITEMS not found in ${source.html}`);
  const items = JSON.parse(match[1]);
  const files = readdirSync(source.imagesDir).filter((f) =>
    /\.(png|jpe?g|webp)$/i.test(f),
  );
  for (const item of items) {
    const imageFile = pickImage(source.listKind, item, files);
    characters.push({
      key: `${source.listKind}-${item.rank}`,
      listKind: source.listKind,
      rank: item.rank,
      name: item.char,
      anime: item.anime,
      xScore: String(item.x),
      pScore: String(item.p),
      avg: item.avg,
      soft: Boolean(item.soft),
      imageFile,
    });
  }
}

const out = join(root, "data", "characters.json");
writeFileSync(out, JSON.stringify(characters, null, 2) + "\n");
console.log(`Wrote ${characters.length} characters to data/characters.json`);
