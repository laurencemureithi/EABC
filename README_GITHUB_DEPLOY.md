# Opsloom GitHub and deployment guide

## Application Runtime
This is a **Node.js (Express + Nunjucks)** application (`server.js`, `package.json`).

## Deploying to Vercel
1. In your **Vercel Dashboard**, open your project.
2. Go to **Settings** > **General** > **Framework Preset**.
3. Change the Framework Preset from **Flask** to **Other** (or ensure it uses the included `vercel.json`).
4. Root directory: `./`
5. Build command: `echo 'Build complete'` (or leave default)
6. Output directory: leave default (the app runs serverless via `api/index.js` and `vercel.json`)
7. Click **Save** and trigger a **Redeploy** on the latest commit.

## Deploying to Render, Railway, or VPS
- Build command: `npm install`
- Start command: `node server.js`
- Port: `3000` (or `process.env.PORT`)

