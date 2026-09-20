# Opsloom GitHub and deployment guide

## Application Runtime
This is a **Node.js (Express + Nunjucks)** application (`server.js`, `package.json`).

## Deploying to Vercel
1. In your **Vercel Dashboard**, open your project.
2. Go to **Settings** > **General** > **Framework Preset**.
3. Set the Framework Preset to **Other** (it will automatically use the included `vercel.json`).
4. Root directory: `./`
5. Build command: `npm run build` (or leave default to let npm build run)
6. Output directory: leave default (static assets are served directly via `public/static` on Vercel's Global CDN Edge, and dynamic requests are routed to `api/index.js` via `vercel.json` rewrites)
7. Click **Save** and trigger a **Redeploy** on the latest commit.

## Deploying to Render, Railway, or VPS
- Build command: `npm install`
- Start command: `node server.js`
- Port: `3000` (or `process.env.PORT`)

