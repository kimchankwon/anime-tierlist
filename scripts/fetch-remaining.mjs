import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.anilist.co";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const QUERY = `
query ($search: String, $page: Int) {
  Media(search: $search, type: ANIME) {
    title { english romaji }
    characters(page: $page, perPage: 50, sort: ROLE) {
      pageInfo { hasNextPage }
      edges { node { id name { full alternative } image { large } } }
    }
  }
}
`;

async function gql(variables) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error("rate limited");
}

async function allCharacters(search) {
  const nodes = [];
  for (let page = 1; page <= 3; page++) {
    const data = await gql({ search, page });
    const block = data.Media?.characters;
    if (!block) break;
    nodes.push(...block.edges.map((e) => e.node));
    if (!block.pageInfo.hasNextPage) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return nodes;
}

function slug(name) {
  return name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}
function hay(n) {
  return [n.name.full, ...(n.name.alternative ?? [])].join(" ").toLowerCase();
}

const remaining = [
  { listKind: "antagonist", name: "Ryomen Sukuna", anime: "Jujutsu Kaisen", media: "Jujutsu Kaisen", match: ["sukuna"], exclude: ["itadori", "yuuji", "yuji"], xScore: "9.0", pScore: "8.0", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Count Saint-Germain", anime: "DAN DA DAN", media: "Dandadan", match: ["saint", "germain", "csg"], xScore: "8.5", pScore: "8.0", avg: 8.25, soft: false },
  { listKind: "antagonist", name: "Kars", anime: "JoJo's Bizarre Adventure", media: "JoJo's Bizarre Adventure (TV)", match: ["kars"], xScore: "9.5", pScore: "7.5", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Kotaro Yanagisawa", anime: "Assassination Classroom", media: "Assassination Classroom Second Season", match: ["yanagisawa", "shiro"], xScore: "6.0", pScore: "6.5", avg: 6.25, soft: false },
  { listKind: "antagonist", name: "Sylvia", anime: "KonoSuba", media: "KonoSuba Legend of Crimson", match: ["sylvia"], xScore: "7.0", pScore: "5.0", avg: 6.0, soft: false },
  { listKind: "antagonist", name: "Stain", anime: "My Hero Academia", media: "My Hero Academia Season 2", match: ["stain", "akaguro"], xScore: "5.0", pScore: "5.5", avg: 5.25, soft: false },
  { listKind: "antagonist", name: "Kai Chisaki", anime: "My Hero Academia", media: "My Hero Academia Season 4", match: ["chisaki", "overhaul"], xScore: "5.0", pScore: "5.5", avg: 5.25, soft: false },
  { listKind: "antagonist", name: "Envy", anime: "Fullmetal Alchemist: Brotherhood", media: "Fullmetal Alchemist: Brotherhood", match: ["envy"], xScore: "8.0", pScore: "8.5", avg: 8.25, soft: false },
  { listKind: "antagonist", name: "Zeke Yeager", anime: "Attack on Titan", media: "Attack on Titan Season 3", match: ["zeke"], xScore: "6.0", pScore: "5.0", avg: 5.5, soft: false },
  { listKind: "antagonist", name: "Garou", anime: "One-Punch Man", media: "One-Punch Man Season 2", match: ["garou"], xScore: "6.0", pScore: "7.0", avg: 6.5, soft: true },
  { listKind: "antagonist", name: "The Winged Lion", anime: "Delicious in Dungeon", media: "Delicious in Dungeon", match: ["winged lion"], xScore: "7.0", pScore: "7.5", avg: 7.25, soft: false },
];

const catalogPath = join(root, "data", "characters.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
// Records are only ever replaced in place, after a lookup and image download
// both succeed. Never delete first: a failed retry used to leave the catalog
// short a character while its downloaded art stayed in seed-assets/.

const existing = new Set(catalog.map((c) => `${c.listKind}:${c.name.toLowerCase()}`));
const nextRank = {
  protagonist: Math.max(0, ...catalog.filter((c) => c.listKind === "protagonist").map((c) => c.rank)),
  antagonist: Math.max(0, ...catalog.filter((c) => c.listKind === "antagonist").map((c) => c.rank)),
};

let added = 0;
for (const item of remaining) {
  if (existing.has(`${item.listKind}:${item.name.toLowerCase()}`)) continue;
  const nodes = await allCharacters(item.media);
  const node = nodes.find((n) => {
    const h = hay(n);
    if ((item.exclude ?? []).some((x) => h.includes(x))) return false;
    return item.match.some((m) => h.includes(m));
  });
  if (!node?.image?.large) {
    console.error("NO MATCH", item.name, "in", item.media, "sample", nodes.slice(0, 15).map((n) => n.name.full));
    continue;
  }
  const dir = join(root, "seed-assets", item.listKind);
  mkdirSync(dir, { recursive: true });
  const imageFile = `${slug(item.name)}.png`;
  const img = await fetch(node.image.large);
  if (!img.ok) {
    console.error(`IMAGE ${img.status} for ${item.name}; skipping`);
    continue;
  }
  writeFileSync(join(dir, imageFile), Buffer.from(await img.arrayBuffer()));
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
  existing.add(`${item.listKind}:${item.name.toLowerCase()}`);
  added += 1;
  console.log("added", item.name, "as", node.name.full);
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
  await new Promise((r) => setTimeout(r, 800));
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
console.log("remaining added", added, "total", catalog.length);
