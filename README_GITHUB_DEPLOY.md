# Opsloom Production Deployment Guide

Opsloom is a production-grade Node.js / Express engineering asset, breakdown management, and preventive maintenance application.

---

## 1. Deploying on Vercel

The repository is configured for modern Vercel Serverless deployments via `vercel.json` and `api/index.js`.

### How It Works on Vercel:
1. **Serverless Entrypoint**: `api/index.js` handles routing transparently, normalizing any internal rewrite paths (`x-matched-path` / `x-forwarded-uri`) so Express routes resolve properly.
2. **Asset & Template Bundling**: `vercel.json` includes `templates/**`, `data/**`, and `static/**` in the serverless bundle.
3. **Writable Datastore**: In serverless environments, Opsloom seeds and maintains state in `/tmp/opsloom_datastore.json`.
4. **HTTPS & Cookie Compatibility**: Cookies and sessions automatically adapt to HTTPS headers (`x-forwarded-proto`).

### Deploy Steps on Vercel:
1. Connect your GitHub repository to Vercel.
2. **Framework Preset**: Select **Other** (Zero Configuration).
3. **Build Command**: `echo 'Build successful'` (or leave default).
4. **Output Directory**: Leave empty.
5. Click **Deploy**. Your Vercel deployment link will load immediately.

### Default Admin Credentials:
- **Email**: `opsloom.ke@gmail.com`
- **Password**: `Admin@123`
- **Role**: System Administrator (Full System access across all company workspaces)

---

## 2. Deploying on a Company Server (VPS / Dedicated Server / Docker)

For organizational deployment on an internal company server (Ubuntu, Debian, RHEL, or Docker):

### Option A: Direct Node.js / PM2 Process Manager
```bash
# 1. Clone the repository and install dependencies
git clone <your-repo-url> opsloom
cd opsloom
npm install --production

# 2. Run with PM2 for production reliability and auto-restart
npm install -g pm2
pm2 start server.js --name "opsloom"
pm2 save
pm2 startup
```

The application binds to `0.0.0.0:3000` (or the port specified by `PORT=80` in your environment variables).

### Option B: Systemd Service (Linux)
Create `/etc/systemd/system/opsloom.service`:
```ini
[Unit]
Description=Opsloom Asset Management
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/opsloom
ExecStart=/usr/bin/node /var/www/opsloom/server.js
Restart=always
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opsloom
```

### Option C: Reverse Proxy with Nginx (Recommended for Production)
```nginx
server {
    listen 80;
    server_name maintenance.yourcompany.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Data Persistence on Company Server:
- All assets, work orders, breakdown tickets, inventory, audit logs, and organization branding persist in `./data/datastore.json`.
- Automatic rolling backups are written to `./data/backups/datastore_latest.json`.

