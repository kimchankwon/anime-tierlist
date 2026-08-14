# Anime Tier Lists

Per-user protagonist and antagonist tier lists, signed in with Google via
Convex Auth. Character art lives in Convex file storage. Dragging a tile
auto-saves that user's board; catalog updates (new or removed characters)
merge into existing layouts without wiping them.

The source boards are the shared-list HTML exports in Downloads:

- Protagonist Tier List (Top 100 Shared)
- Antagonist Tier List (Shared Top 200)

## Stack

- Vite + React frontend, hosted on Netlify
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

`netlify.toml` builds with `npx convex deploy --cmd "npm run build"` and
publishes `dist`. Set `CONVEX_DEPLOY_KEY` and `VITE_CONVEX_URL` on Netlify,
then point Convex prod `SITE_URL` at the Netlify domain.
