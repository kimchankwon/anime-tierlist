import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.anilist.co";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME) {
    title { english romaji }
    characters(page: 1, perPage: 50, sort: ROLE) {
      edges {
        node { id name { full alternative } image { large } }
      }
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
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error("rate limited");
}

function slug(name) {
  return name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

const retries = [
  { listKind: "protagonist", name: "Ken Takakura", anime: "DAN DA DAN", media: "DAN DA DAN", match: ["okarun", "ken takakura", "ken"], xScore: "8.5", pScore: "8.0", avg: 8.25, soft: true },
  { listKind: "antagonist", name: "Evil Eye", anime: "DAN DA DAN", media: "DAN DA DAN", match: ["evil eye", "jiji"], xScore: "8.5", pScore: "8.0", avg: 8.25, soft: false },
  { listKind: "antagonist", name: "Count Saint-Germain", anime: "DAN DA DAN", media: "DAN DA DAN", match: ["saint-germain", "saint germain"], xScore: "8.5", pScore: "8.0", avg: 8.25, soft: false },
  { listKind: "protagonist", name: "Yuji Itadori", anime: "Jujutsu Kaisen", media: "Jujutsu Kaisen", match: ["itadori", "yuuji"], xScore: "9.0", pScore: "8.0", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Ryomen Sukuna", anime: "Jujutsu Kaisen", media: "Jujutsu Kaisen", match: ["sukuna"], xScore: "9.0", pScore: "8.0", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Mahito", anime: "Jujutsu Kaisen", media: "Jujutsu Kaisen", match: ["mahito"], xScore: "9.0", pScore: "8.0", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Kars", anime: "JoJo's Bizarre Adventure", media: "JoJo's Bizarre Adventure", match: ["kars"], xScore: "9.5", pScore: "7.5", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Diavolo", anime: "JoJo's Bizarre Adventure", media: "JoJo's Bizarre Adventure: Golden Wind", match: ["diavolo"], xScore: "9.5", pScore: "7.5", avg: 8.5, soft: false },
  { listKind: "antagonist", name: "Toichiro Suzuki", anime: "Mob Psycho 100", media: "Mob Psycho 100", match: ["toichiro", "touichirou", "suzuki"], xScore: "7.0", pScore: "7.5", avg: 7.25, soft: false },
  { listKind: "protagonist", name: "Riko", anime: "Made in Abyss", media: "Made in Abyss", match: ["riko"], xScore: "6.0", pScore: "8.0", avg: 7.0, soft: false },
  { listKind: "protagonist", name: "Reg", anime: "Made in Abyss", media: "Made in Abyss", match: ["reg"], xScore: "6.0", pScore: "8.0", avg: 7.0, soft: true },
  { listKind: "antagonist", name: "Gilgamesh", anime: "Fate/stay night: Unlimited Blade Works", media: "Fate/stay night: Unlimited Blade Works", match: ["gilgamesh"], xScore: "6.0", pScore: "7.5", avg: 6.75, soft: false },
  { listKind: "protagonist", name: "Miyu Suzuki", anime: "You and I Are Polar Opposites", media: "You and I Are Polar Opposites", match: ["miyu"], xScore: "6.5", pScore: "7.0", avg: 6.75, soft: true },
  { listKind: "antagonist", name: "The Reaper", anime: "Assassination Classroom", media: "Assassination Classroom", match: ["reaper", "god of death", "shinigami"], xScore: "6.0", pScore: "6.5", avg: 6.25, soft: false },
  { listKind: "antagonist", name: "Kotaro Yanagisawa", anime: "Assassination Classroom", media: "Assassination Classroom", match: ["yanagisawa", "shiro"], xScore: "6.0", pScore: "6.5", avg: 6.25, soft: false },
  { listKind: "antagonist", name: "Sylvia", anime: "KonoSuba", media: "KonoSuba", match: ["sylvia"], xScore: "7.0", pScore: "5.0", avg: 6.0, soft: false },
  { listKind: "antagonist", name: "Stain", anime: "My Hero Academia", media: "My Hero Academia", match: ["stain", "chimera", "akaguro"], xScore: "5.0", pScore: "5.5", avg: 5.25, soft: false },
  { listKind: "antagonist", name: "Kai Chisaki", anime: "My Hero Academia", media: "My Hero Academia", match: ["chisaki", "overhaul"], xScore: "5.0", pScore: "5.5", avg: 5.25, soft: false },
  { listKind: "antagonist", name: "Near", anime: "Death Note", media: "Death Note", match: ["near", "nate river"], xScore: "9.5", pScore: "7.0", avg: 8.25, soft: false },
  { listKind: "antagonist", name: "Mello", anime: "Death Note", media: "Death Note", match: ["mello", "mihael"], xScore: "9.5", pScore: "7.0", avg: 8.25, soft: false },
  { listKind: "antagonist", name: "Envy", anime: "Fullmetal Alchemist: Brotherhood", media: "Fullmetal Alchemist: Brotherhood", match: ["envy"], xScore: "8.0", pScore: "8.5", avg: 8.25, soft: false },
  { listKind: "antagonist", name: "Zeke Yeager", anime: "Attack on Titan", media: "Attack on Titan", match: ["zeke"], xScore: "6.0", pScore: "5.0", avg: 5.5, soft: false },
  { listKind: "antagonist", name: "Garou", anime: "One-Punch Man", media: "One-Punch Man", match: ["garou"], xScore: "6.0", pScore: "7.0", avg: 6.5, soft: true },
  { listKind: "antagonist", name: "Keel Lorenz", anime: "The End of Evangelion", media: "Neon Genesis Evangelion", match: ["keel", "lorenz", "seele"], xScore: "7.0", pScore: "9.0", avg: 8.0, soft: false },
  { listKind: "antagonist", name: "No-Face", anime: "Spirited Away", media: "Spirited Away", match: ["no-face", "noface", "kaonashi"], xScore: "6.5", pScore: "8.0", avg: 7.25, soft: false },
  { listKind: "antagonist", name: "The Winged Lion", anime: "Delicious in Dungeon", media: "Delicious in Dungeon", match: ["winged lion", "lion"], xScore: "7.0", pScore: "7.5", avg: 7.25, soft: false },
];

function haystack(node) {
  return [node.name.full, ...(node.name.alternative ?? [])].join(" ").toLowerCase();
}

const catalogPath = join(root, "data", "characters.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const existing = new Set(catalog.map((c) => `${c.listKind}:${c.name.toLowerCase()}`));
const nextRank = {
  protagonist: Math.max(0, ...catalog.filter((c) => c.listKind === "protagonist").map((c) => c.rank)),
  antagonist: Math.max(0, ...catalog.filter((c) => c.listKind === "antagonist").map((c) => c.rank)),
};

let added = 0;
for (const item of retries) {
  if (existing.has(`${item.listKind}:${item.name.toLowerCase()}`)) continue;
  const data = await gql({ search: item.media });
  const edges = data.Media?.characters?.edges ?? [];
  const node = edges
    .map((e) => e.node)
    .find((n) => item.match.some((m) => haystack(n).includes(m)));
  if (!node?.image?.large) {
    console.error("NO MATCH", item.name, "in", data.Media?.title, "have", edges.map((e) => e.node.name.full).slice(0, 20));
    continue;
  }
  const dir = join(root, "seed-assets", item.listKind);
  mkdirSync(dir, { recursive: true });
  const imageFile = `${slug(item.name)}.png`;
  const dest = join(dir, imageFile);
  if (!existsSync(dest)) {
    const img = await fetch(node.image.large);
    if (!img.ok) {
      console.error(`IMAGE ${img.status} for ${item.name}; skipping`);
      continue;
    }
    writeFileSync(dest, Buffer.from(await img.arrayBuffer()));
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
  existing.add(`${item.listKind}:${item.name.toLowerCase()}`);
  added += 1;
  console.log("added", item.listKind, item.name, "as", node.name.full);
  await new Promise((r) => setTimeout(r, 300));
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
console.log("retry added", added, "total", catalog.length);
