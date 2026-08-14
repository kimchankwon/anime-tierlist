import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const url = process.env.CONVEX_URL || env.VITE_CONVEX_URL;
const secret = process.env.SEED_SECRET || env.SEED_SECRET;
if (!url) throw new Error("VITE_CONVEX_URL missing from .env.local");
if (!secret) throw new Error("SEED_SECRET missing from .env.local");

const client = new ConvexHttpClient(url);
const characters = JSON.parse(
  readFileSync(join(root, "data", "characters.json"), "utf8"),
);
const seeded = await client.query(anyApi.seed.listSeeded, { secret });
const already = new Map(seeded.map((row) => [row.key, row]));

const types = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

let uploaded = 0;
let skipped = 0;
for (const character of characters) {
  const prev = already.get(character.key);
  if (prev?.hasImage && process.argv[2] !== "--force") {
    skipped += 1;
    continue;
  }
  const uploadUrl = await client.mutation(anyApi.seed.generateUploadUrl, { secret });
  const filePath = join(
    root,
    "seed-assets",
    character.listKind,
    character.imageFile,
  );
  const bytes = readFileSync(filePath);
  const contentType = types[extname(character.imageFile).toLowerCase()] ?? "application/octet-stream";
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Upload failed for ${character.key}: ${res.status} ${await res.text()}`);
  }
  const { storageId } = await res.json();
  await client.mutation(anyApi.seed.upsertCharacter, {
    secret,
    ...character,
    imageId: storageId,
  });
  uploaded += 1;
  console.log(`seeded ${character.key} (${character.name})`);
}

console.log(`done. uploaded=${uploaded} skipped=${skipped} total=${characters.length}`);
