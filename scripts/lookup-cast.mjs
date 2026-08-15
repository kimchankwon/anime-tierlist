const query = `
query ($s: String) {
  Media(search: $s, type: ANIME) {
    title { english romaji }
    characters(sort: ROLE, perPage: 15) {
      edges { role node { name { full } } }
    }
  }
}
`;

async function look(s) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { s } }),
  });
  const j = await res.json();
  const m = j.data?.Media;
  console.log("\n==", s, "=>", m?.title);
  for (const e of m?.characters?.edges ?? []) console.log(e.role, e.node.name.full);
}

for (const s of process.argv.slice(2)) {
  await look(s);
  await new Promise((r) => setTimeout(r, 350));
}
