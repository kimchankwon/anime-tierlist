# Anime Tier Lists

Per-user protagonist and antagonist tier lists, signed in with Google via
Convex Auth. Character art lives in Convex file storage. Dragging a tile
auto-saves that user's board; catalog updates (new or removed characters)
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
protagonist and antagonist lists.

## Deploy

Pushes to `main` build the frontend and publish it to GitHub Pages via
`.github/workflows/pages.yml`. Production Convex is
`https://watchful-platypus-235.convex.cloud`; set prod `SITE_URL` to
`https://kimchankwon.github.io/anime-tierlist`.
