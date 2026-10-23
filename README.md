# EABC / Opsloom — Engineering Asset & Breakdown Management System

A mission-critical, multi-organization operations management and industrial equipment reliability system with PostgreSQL database persistence, tenant isolation, preventive maintenance workflows, spare parts inventory control, and strategic intelligence reporting.

---

## Architecture & Compatibility

- **Runtime Engine**: Node.js **18.x LTS**, **20.x LTS**, or **22.x LTS**
- **Persistence Store**: **PostgreSQL 14+ / 15+ / 16+** (Native connection pooling via `pg`)
- **Web Framework**: Express 5.x with Nunjucks templates and Tailwind CSS
- **Operating Systems**: 
  - Windows 10 / 11 / Windows Server (PowerShell or CMD)
  - Ubuntu / Debian / RHEL / CentOS Linux
  - macOS (Apple Silicon / Intel)
- **Supported Deployments**:
  1. Personal laptop for local development & demonstration.
  2. Desktop or server hosting on a Local Area Network (LAN).
  3. Production Linux / Windows server.
  4. Containerized environments (Docker / Kubernetes / Cloud SQL).

---

## Quick Start (Local Laptop Setup)

### 1. Prerequisites
- Install **Node.js 18+ or 20+ LTS** ([nodejs.org](https://nodejs.org/))
- Install **PostgreSQL 14+** ([postgresql.org](https://www.postgresql.org/download/))

### 2. Database Creation
In your PostgreSQL shell (`psql` or pgAdmin), create the application database:

```sql
CREATE DATABASE eabc_db;
CREATE USER eabc_user WITH ENCRYPTED PASSWORD 'StrongPassword123!';
GRANT ALL PRIVILEGES ON DATABASE eabc_db TO eabc_user;
```

### 3. Clone & Configure Environment

```bash
# Clone the repository
git clone https://github.com/laurencemureithi/EABC.git
cd EABC

# Install dependencies
npm install

# Copy configuration template
# On Windows (PowerShell):
Copy-Item .env.example .env
# On Linux / macOS:
cp .env.example .env
```

Edit your `.env` file with your database credentials:
```ini
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://eabc_user:StrongPassword123!@localhost:5432/eabc_db
SESSION_SECRET=your_32_character_super_secret_session_key_here
TZ=Africa/Nairobi
ADMIN_PRIMARY_EMAIL=opsloom.ke@gmail.com
ADMIN_LOGIN_PASSWORD=Admin@123
```

### 4. Run Automated Migrations & Start

```bash
# 1. Run version-controlled database migrations
npm run db:migrate

# 2. (Optional) Seed realistic demonstration data for development/demo
npm run db:seed

# 3. Start the application
npm start
```

Open your browser to: **`http://localhost:3000/login`**
- **Email**: `opsloom.ke@gmail.com`
- **Password**: `Admin@123`

---

## Local Organizational Network (LAN) Deployment

To run EABC on an office laptop or workstation so colleagues across your company LAN can access it:

### 1. Configure Host Binding in `.env`
Set `HOST=0.0.0.0` so the server listens on all network interfaces:
```ini
HOST=0.0.0.0
PORT=3000
```

### 2. Identify the Host Machine's Local IP Address
- **On Windows (PowerShell/CMD)**:
  ```powershell
  ipconfig
  # Look for "IPv4 Address", e.g. 192.168.1.105
  ```
- **On Linux**:
  ```bash
  ip route get 1.1.1.1 | awk '{print $7}'
  ```

### 3. Open Firewall Port (3000)
- **Windows Firewall**:
  ```powershell
  # Run in PowerShell as Administrator:
  New-NetFirewallRule -DisplayName "EABC Server (Port 3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
  ```
- **Linux (UFW)**:
  ```bash
  sudo ufw allow 3000/tcp
  sudo ufw status
  ```

### 4. Access from LAN Workstations
Colleagues on the same WiFi / Ethernet network can open:
```
http://192.168.1.105:3000/login
```
*(Replace `192.168.1.105` with your host machine's actual LAN IP).*

> **Security Note**: Never expose PostgreSQL port 5432 directly to the LAN or internet. Only port 3000 (HTTP) should be open to authorized workstations.

---

## Production Linux Server Deployment (Systemd + Nginx)

### 1. Systemd Service Configuration
Create `/etc/systemd/system/eabc.service`:

```ini
[Unit]
Description=EABC Engineering Reliability Operations Service
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/eabc
EnvironmentFile=/var/www/eabc/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=eabc

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable eabc
sudo systemctl start eabc
sudo systemctl status eabc
```

### 2. Nginx Reverse Proxy Configuration
Create `/etc/nginx/sites-available/eabc`:

```nginx
server {
    listen 80;
    server_name eabc.yourcompany.co.ke;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }
}
```

Enable site and configure SSL with Let's Encrypt:
```bash
sudo ln -s /etc/nginx/sites-available/eabc /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d eabc.yourcompany.co.ke
```

---

## Database Management & Operations

### 1. Migrations
Database migrations are version-controlled in `database/migrations/`:
- `0001_initial_schema.sql`: Core 15 database tables.
- `0002_indexes_and_constraints.sql`: Multi-tenant performance indexes & constraints.

To run migrations:
```bash
npm run db:migrate
```
The migration runner records applied migrations in the `schema_migrations` table, making it completely idempotent and safe to run on every deploy.

### 2. Health & Readiness Probe
Check application and database health without authentication:
```bash
curl http://localhost:3000/health
```
**Response (HTTP 200)**:
```json
{
  "status": "healthy",
  "database": "connected",
  "latency_ms": 7,
  "pool": { "total": 15, "idle": 15, "waiting": 0 },
  "uptime_seconds": 1284,
  "timestamp": "2026-10-23T12:30:22.452Z"
}
```
If the database connection is interrupted, the probe returns **HTTP 503** with `"status": "degraded"`.

### 3. Automated Database Backups
Create a backup directory and run `pg_dump`:

```bash
# Manual Backup
pg_dump -U postgres -d eabc_db -F c -b -v -f /var/backups/eabc_$(date +%Y%m%d_%H%M%S).dump

# Automated Daily Cron Backup (Linux)
0 2 * * * pg_dump -U postgres -d eabc_db -F c -f /var/backups/eabc_$(date +\%Y\%m\%d).dump && find /var/backups -name "eabc_*.dump" -mtime +30 -delete
```

### 4. Database Restoration
To restore from a backup:
```bash
pg_restore -U postgres -d eabc_db -v -c /var/backups/eabc_20261023.dump
```

---

## Available NPM Scripts

| Command | Description |
| :--- | :--- |
| `npm start` | Launches the production server using `node server.js` |
| `npm run dev` | Runs the server in development mode |
| `npm run db:migrate` | Runs all pending database migrations safely |
| `npm run db:seed` | Explicitly seeds realistic demonstration records (development only) |
| `npm run lint` | Runs syntax and structural validation |
| `npm test` | Runs the 21 comprehensive end-to-end business system tests |

---

## Security Best Practices
1. **Never commit `.env`** to version control.
2. **Rotate `SESSION_SECRET`** and database passwords before deploying to production.
3. **Change initial admin password** (`Admin@123`) upon first login via **Settings > Profile**.
4. **Use HTTPS** in production via reverse proxy or Cloud SSL termination.
5. **Session Cookies**: Automatically marked `HttpOnly` and configured with inactivity timeouts.
