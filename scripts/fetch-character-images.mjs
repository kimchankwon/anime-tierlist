import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.anilist.co";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SEARCH = `
query ($search: String) {
  Character(search: $search) {
    id
    name { full native }
    image { large }
  }
}
`;

async function gql(query, variables) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 5) * 1000;
      await new Promise((r) => setTimeout(r, wait + 500));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error("rate limited");
}

function slug(name) {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export async function downloadCharacterImage(listKind, name, search = name) {
  const dir = join(root, "seed-assets", listKind);
  mkdirSync(dir, { recursive: true });
  const file = `${slug(name)}.png`;
  const dest = join(dir, file);
  if (existsSync(dest)) return file;
  const data = await gql(SEARCH, { search });
  const url = data.Character?.image?.large;
  if (!url) throw new Error(`No AniList image for ${search}`);
  const img = await fetch(url);
  if (!img.ok) throw new Error(`image ${img.status} for ${search}`);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(dest, buf);
  await new Promise((r) => setTimeout(r, 250));
  return file;
}

if (process.argv[1] && process.argv[1].endsWith("fetch-character-images.mjs") && process.argv[2] === "--one") {
  const file = await downloadCharacterImage(process.argv[3], process.argv[4], process.argv[5] ?? process.argv[4]);
  console.log(file);
}
