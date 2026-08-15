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
let metadataOnly = 0;
for (const character of characters) {
  const prev = already.get(character.key);
  // Re-upload the art only when it is missing (or forced), but always write the
  // row. Skipping the whole character when it already had an image meant catalog
  // edits - ranks, scores, names, the anime a character belongs to - were never
  // deployed, so the site kept serving stale metadata.
  const needsUpload = !prev?.hasImage || process.argv[2] === "--force";
  let imageId;
  if (needsUpload) {
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
    ({ storageId: imageId } = await res.json());
    uploaded += 1;
    console.log(`seeded ${character.key} (${character.name})`);
  } else {
    metadataOnly += 1;
  }
  await client.mutation(anyApi.seed.upsertCharacter, {
    secret,
    ...character,
    ...(imageId ? { imageId } : {}),
  });
}

console.log(
  `done. uploaded=${uploaded} metadata-only=${metadataOnly} total=${characters.length}`,
);
