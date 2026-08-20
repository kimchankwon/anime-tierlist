# Anime Tier Lists

Per-user protagonist and antagonist tier lists, signed in with Google via
Convex Auth. Character art lives in Convex file storage. Dragging a tile
auto-saves that user's board (pointer drag, so it works on a phone too);
catalog updates (new or removed characters)
merge into existing layouts without wiping them.

The source boards are the shared-list HTML exports in Downloads:

- Protagonist Tier List (Top 100 Shared)
- Antagonist Tier List (Shared Top 200)

**Live:** https://kimchankwon.github.io/anime-tierlist/

## Stack

- Vite + React frontend on GitHub Pages
- Convex database, file storage, and Convex Auth (Google)
- Same Google sign-in pattern as `kimchankwon/relationship-app`

## Local

See [SETUP.md](SETUP.md). Short version:

```bash
npm install
npx convex dev --once
npm run extract
npm run seed
npm run dev
```

Sign in at http://localhost:5173. Each Google account gets its own saved
protagonist and antagonist lists. New boards start **unranked**; use
Auto-fill by score only if you want that.

The catalog is the intersection of
[xtectra](https://anilist.co/user/xtectra/animelist) and
[Prowtar](https://anilist.co/user/Prowtar/animelist), with seasons collapsed
into one franchise. Several leads and arc antagonists can come from the same
show (for example Near as Death Note's second antagonist).

## Deploy

Merges to `main` run two workflows:

- **Convex Deploy** (`.github/workflows/convex-deploy.yml`) — `npx convex deploy`
  to production, same shape as `the-shed-mobile`. Needs the `CONVEX_DEPLOY_KEY`
  repo secret (Convex dashboard → prod → Settings → Deploy key). Manual
  `workflow_dispatch` from a non-main branch deploys a preview.
- **GitHub Pages** (`.github/workflows/pages.yml`) — builds the Vite app against
  `https://watchful-platypus-235.convex.cloud` and publishes
  https://kimchankwon.github.io/anime-tierlist/

Prod `SITE_URL` must stay `https://kimchankwon.github.io/anime-tierlist`.
