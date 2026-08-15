import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.anilist.co";

const LIST_QUERY = `
query ($userName: String) {
  MediaListCollection(userName: $userName, type: ANIME) {
    lists {
      name
      isCustomList
      entries {
        status
        score(format: POINT_10_DECIMAL)
        media {
          id
          idMal
          format
          status
          seasonYear
          title { romaji english native }
          relations {
            edges {
              relationType(version: 2)
              node { id type format title { romaji english } }
            }
          }
        }
      }
    }
  }
}
`;

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(JSON.stringify(json.errors ?? json, null, 2));
  }
  return json.data;
}

function flatten(collection) {
  const byId = new Map();
  for (const list of collection.lists ?? []) {
    if (list.isCustomList) continue;
    for (const entry of list.entries ?? []) {
      const media = entry.media;
      if (!media) continue;
      const prev = byId.get(media.id);
      if (!prev || (entry.score ?? 0) > (prev.score ?? 0)) {
        byId.set(media.id, {
          mediaId: media.id,
          title: media.title.english || media.title.romaji,
          romaji: media.title.romaji,
          format: media.format,
          status: entry.status,
          score: entry.score ?? 0,
          year: media.seasonYear,
          relations: (media.relations?.edges ?? [])
            .filter((e) => e.node?.type === "ANIME")
            .map((e) => ({ type: e.relationType, id: e.node.id, title: e.node.title.english || e.node.title.romaji, format: e.node.format })),
        });
      }
    }
  }
  return [...byId.values()];
}

function franchiseRoot(entry, index) {
  const seen = new Set();
  let id = entry.mediaId;
  for (let i = 0; i < 20; i++) {
    if (seen.has(id)) break;
    seen.add(id);
    const node = index.get(id);
    if (!node) break;
    const prequel = node.relations.find(
      (r) => r.type === "PREQUEL" || r.type === "PARENT",
    );
    if (!prequel) break;
    id = prequel.id;
  }
  return id;
}

// Continuity only. ALTERNATIVE would fold separate adaptations (FMA 2003 and
// FMA: Brotherhood) into one franchise, which is not what "collapse seasons"
// means here.
const SAME_FRANCHISE = new Set(["SEQUEL", "PREQUEL", "PARENT"]);

function collapse(entries) {
  const index = new Map(entries.map((e) => [e.mediaId, e]));
  const groups = new Map();
  for (const entry of entries) {
    const root = franchiseRoot(entry, index);
    const g = groups.get(root) ?? { root, members: [], best: entry };
    g.members.push(entry);
    if ((entry.score ?? 0) > (g.best.score ?? 0)) g.best = entry;
    groups.set(root, g);
  }
  return [...groups.values()].map((g) => ({
    rootId: g.root,
    title: g.best.title,
    score: g.best.score,
    formats: [...new Set(g.members.map((m) => m.format))],
    memberIds: g.members.map((m) => m.mediaId),
    memberTitles: g.members.map((m) => m.title),
  }));
}

const xtectra = flatten(await gql(LIST_QUERY, { userName: "xtectra" }).then((d) => d.MediaListCollection));
const prowtar = flatten(await gql(LIST_QUERY, { userName: "Prowtar" }).then((d) => d.MediaListCollection));
const xFranchises = collapse(xtectra);
const pFranchises = collapse(prowtar);

// Direct membership: the two lists share an actual media id.
const pByMembers = new Map();
for (const f of pFranchises) {
  for (const id of f.memberIds) pByMembers.set(id, f);
}

// franchiseRoot() can only walk relations that are themselves in the user's
// list, so two users who watched disjoint installments of one franchise end up
// with no overlapping memberIds and the franchise is dropped. Index one hop of
// continuity-related media as a fallback, consulted only when there is no
// direct hit, so a bridged match can never duplicate a direct one.
const pByRelated = new Map();
const prowtarById = new Map(prowtar.map((e) => [e.mediaId, e]));
for (const f of pFranchises) {
  for (const id of f.memberIds) {
    for (const rel of prowtarById.get(id)?.relations ?? []) {
      if (!SAME_FRANCHISE.has(rel.type)) continue;
      if (!pByMembers.has(rel.id) && !pByRelated.has(rel.id)) {
        pByRelated.set(rel.id, f);
      }
    }
  }
}

const shared = [];
const seen = new Set();
const claimed = new Set();
// Direct matches first so they always win the claim on a Prowtar franchise.
const ordered = [
  ...xFranchises.map((xf) => [xf, xf.memberIds.map((id) => pByMembers.get(id)).find(Boolean), "direct"]),
  ...xFranchises.map((xf) => [xf, xf.memberIds.map((id) => pByRelated.get(id)).find(Boolean), "related"]),
];
for (const [xf, hit, how] of ordered) {
  if (!hit) continue;
  if (how === "related" && claimed.has(hit.rootId)) continue;
  const key = [xf.rootId, hit.rootId].sort().join("-");
  if (seen.has(key)) continue;
  if (claimed.has(hit.rootId) && how === "related") continue;
  seen.add(key);
  claimed.add(hit.rootId);
  shared.push({
    title: xf.title,
    xTitle: xf.title,
    pTitle: hit.title,
    xScore: xf.score,
    pScore: hit.score,
    avg: (xf.score + hit.score) / 2,
    xIds: xf.memberIds,
    pIds: hit.memberIds,
    titles: [...new Set([...xf.memberTitles, ...hit.memberTitles])],
  });
}

shared.sort((a, b) => b.avg - a.avg || a.title.localeCompare(b.title));

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(
  join(root, "data", "anilist-shared.json"),
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      xtectraEntries: xtectra.length,
      prowtarEntries: prowtar.length,
      xtectraFranchises: xFranchises.length,
      prowtarFranchises: pFranchises.length,
      sharedFranchises: shared.length,
      shared,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      xtectraEntries: xtectra.length,
      prowtarEntries: prowtar.length,
      xtectraFranchises: xFranchises.length,
      prowtarFranchises: pFranchises.length,
      sharedFranchises: shared.length,
    },
    null,
    2,
  ),
);
