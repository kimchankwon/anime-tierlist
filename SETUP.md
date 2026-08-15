# Setup

This app uses **Vite + React**, **Convex** (database, file storage, and auth),
and **Convex Auth with Google**. The frontend deploys to **GitHub Pages**.

Auth follows the same pattern as `kimchankwon/relationship-app`:
`convexAuth({ providers: [Google] })`, HTTP routes on `convex/http.ts`, and
`useAuthActions().signIn("google")` on the client.

## 1. Install and create the Convex project

```bash
npm install
npx convex dev --once --configure new --team kimchankwon --project anime-tierlist --dev-deployment cloud
```

Leave `npx convex dev` running later while you work. It writes
`CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` into `.env.local`.

## 2. Convex Auth keys

```bash
node scripts/generate-keys.mjs
```

Copy the two lines into Convex env (or set them from the output):

```bash
npx convex env set JWT_PRIVATE_KEY "<value>"
npx convex env set JWKS "<value>"
npx convex env set SITE_URL http://localhost:5173
```

## 3. Google sign-in

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services →
Credentials → **Create OAuth client ID** → Web application (or reuse the
relationship-app client).

This project already reuses the relationship-app Google OAuth client. Add these
to that client (or a new Web client) in Google Cloud Console:

**Authorized JavaScript origins**

- `http://localhost:5173`
- `https://uncommon-pika-420.convex.site` (dev)
- `https://watchful-platypus-235.convex.site` (prod)
- `https://kimchankwon.github.io`

**Authorized redirect URIs**

- `https://uncommon-pika-420.convex.site/api/auth/callback/google`
- `https://watchful-platypus-235.convex.site/api/auth/callback/google`

```bash
npx convex env set AUTH_GOOGLE_ID <client-id>
npx convex env set AUTH_GOOGLE_SECRET <client-secret>
```

## 4. Seed character art into Convex storage

```bash
npx convex env set SEED_SECRET <long-random-string>
```

Put the same value in `.env.local` as `SEED_SECRET=...`, then:

```bash
npm run extract
npm run seed
```

Images are uploaded from `seed-assets/` and attached to the shared character
catalog. Each signed-in user then gets their own saved layout.

## 5. Run it

```bash
npm run dev
```

Open http://localhost:5173 and sign in with Google.

## Deploy to GitHub Pages

Pushes to `main` run `.github/workflows/pages.yml` and publish
https://kimchankwon.github.io/anime-tierlist/

1. Vite `base` is `/anime-tierlist/` so asset URLs work on the project site.
2. The workflow bakes in the production Convex URL
   `https://watchful-platypus-235.convex.cloud`.
3. Prod `SITE_URL` must be `https://kimchankwon.github.io/anime-tierlist`
   so Google sign-in returns to the app, not the github.io root.
4. Add `https://kimchankwon.github.io` as a Google OAuth JavaScript origin.
