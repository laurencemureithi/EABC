/**
 * PRODUCTION DEPLOYMENT INTEGRATION GUIDE
 * Step-by-step instructions for deploying EABC enterprise edition
 */

# EABC Enterprise Deployment Guide

## Pre-Deployment Checklist

### 1. Database Setup

```bash
# Create PostgreSQL database
createdb -U postgres eabc_production

# Run all migration scripts (in order)
psql -U postgres -d eabc_production -f database/migrations.js

# Verify schema
psql -U postgres -d eabc_production -c "\dt"
```

### 2. Environment Configuration

```bash
# Copy template and configure
cp .env.example .env.production

# Edit with production values
nano .env.production

# Verify critical variables are set
echo "DB_HOST: $DB_HOST"
echo "NODE_ENV: $NODE_ENV"
echo "PORT: $PORT"
```

### 3. Dependencies Installation

```bash
# Install production dependencies
npm ci --only=production

# Verify no audit vulnerabilities
npm audit
```

### 4. SSL/TLS Certificates

```bash
# For Let's Encrypt (recommended)
certbot certonly --standalone -d eabc.yourdomain.com

# Configure in reverse proxy (nginx/Apache)
# or in Express if using built-in HTTPS
```

### 5. Session Store Configuration

**For Single Server Deployment:**
```javascript
// Use default session store (development) - NOT for production
// app.use(session({ store: new MemoryStore() }));
```

**For Production (Recommended):**
```bash
# Install Redis
sudo apt-get install redis-server

# Or use managed Redis (AWS ElastiCache, Google Cloud Memorystore)

# Configure in app:
SESSION_STORE=redis
REDIS_URL=redis://localhost:6379
```

### 6. Logging Configuration

```bash
# Create logs directory
mkdir -p ./logs
chown -R app-user ./logs
chmod 755 ./logs

# Configure log rotation (logrotate)
sudo tee /etc/logrotate.d/eabc > /dev/null <<EOF
/path/to/eabc/logs/*.log {
  daily
  rotate 30
  compress
  delaycompress
  notifempty
  create 0640 app-user app-group
}
EOF
```

### 7. File Uploads & Storage

```bash
# Create uploads directory
mkdir -p ./uploads
chown -R app-user:app-group ./uploads
chmod 755 ./uploads

# For production, use cloud storage (AWS S3, Google Cloud Storage)
# Configure credentials in environment variables
```

## Deployment Methods

### Option A: Traditional Server (VPS/Cloud Instance)

```bash
# 1. SSH into server
ssh user@your-server.com

# 2. Clone repository
git clone https://github.com/laurencemureithi/EABC.git
cd EABC
git checkout enterprise-deployment-v1

# 3. Setup Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Install dependencies
npm ci --only=production

# 5. Create systemd service
sudo tee /etc/systemd/system/eabc.service > /dev/null <<EOF
[Unit]
Description=EABC Enterprise Application
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=eabc
WorkingDirectory=/home/eabc/EABC
Environment="NODE_ENV=production"
Environment="PORT=3000"
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 6. Enable and start service
sudo systemctl enable eabc
sudo systemctl start eabc

# 7. Configure reverse proxy (nginx)
sudo apt-get install -y nginx

# 8. Verify deployment
curl http://localhost:3000/health
```

### Option B: Docker Deployment

```bash
# 1. Create Dockerfile (if not exists)
cat > Dockerfile <<EOF
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
EOF

# 2. Build image
docker build -t eabc:enterprise-v1 .

# 3. Create docker-compose.yml
cat > docker-compose.yml <<EOF
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: eabc_production
      POSTGRES_USER: eabc
      POSTGRES_PASSWORD: your_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/migrations.js:/docker-entrypoint-initdb.d/migrations.js

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  eabc:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: eabc
      DB_PASSWORD: your_password
      DB_NAME: eabc_production
      SESSION_STORE: redis
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  postgres_data:
  redis_data:
EOF

# 4. Deploy
docker-compose up -d

# 5. Verify
docker-compose logs -f eabc
```

### Option C: Kubernetes Deployment

```bash
# 1. Create namespace
kubectl create namespace eabc-production

# 2. Create ConfigMap for environment
kubectl create configmap eabc-config \
  --from-literal=NODE_ENV=production \
  --from-literal=PORT=3000 \
  -n eabc-production

# 3. Create Secret for sensitive data
kubectl create secret generic eabc-secrets \
  --from-literal=DB_PASSWORD=your_password \
  --from-literal=SESSION_SECRET=your_secret \
  -n eabc-production

# 4. Deploy with Helm or kubectl
kubectl apply -f k8s/deployment.yaml -n eabc-production

# 5. Check pods
kubectl get pods -n eabc-production

# 6. Check logs
kubectl logs -f deployment/eabc -n eabc-production
```

## Post-Deployment Verification

```bash
# 1. Health check
curl https://eabc.yourdomain.com/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2026-10-12T10:00:00.000Z",
#   "checks": {
#     "database": { "status": "connected" },
#     "memory": { "status": "healthy" }
#   }
# }

# 2. Test authentication
curl -X POST https://eabc.yourdomain.com/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@example.com&password=password"

# 3. Verify workspace isolation
curl https://eabc.yourdomain.com/api/assets \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Company-ID: company-1"

# 4. Check audit logging
curl https://eabc.yourdomain.com/api/audit-trail \
  -H "Authorization: Bearer $TOKEN"

# 5. Run diagnostic
curl https://eabc.yourdomain.com/api/diagnostics \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Monitoring & Operations

### Application Monitoring

```bash
# Monitor logs in production
tail -f ./logs/error.log
tail -f ./logs/info.log

# Monitor system resources
watch -n 1 'curl -s http://localhost:3000/health | jq .checks.memory'

# Set up alerts (recommend using Prometheus + Grafana)
```

### Backup Strategy

```bash
# Daily PostgreSQL backup
0 2 * * * pg_dump -U postgres eabc_production | gzip > /backups/eabc-$(date +%Y%m%d).sql.gz

# Backup to S3
0 3 * * * aws s3 cp /backups/eabc-$(date +%Y%m%d).sql.gz s3://your-backup-bucket/

# Retention: Keep 30 days
find /backups -name "eabc-*.sql.gz" -mtime +30 -delete
```

### Scaling Recommendations

- **Session Store**: Must use Redis (not memory) for horizontal scaling
- **Database Pool**: Increase pool_size in database.js if traffic > 1000 req/sec
- **Load Balancer**: Use sticky sessions if not using Redis session store
- **Read Replicas**: Add PostgreSQL read replicas for dashboards/reports

## Security Hardening

### Additional Measures

1. **WAF (Web Application Firewall)**
   - AWS WAF
   - Cloudflare
   - ModSecurity + nginx

2. **DDoS Protection**
   - Cloudflare DDoS
   - AWS Shield
   - Rate limiting (already configured)

3. **SSL/TLS**
   - Use TLS 1.2+
   - Enable HSTS
   - Certificate pinning for API clients

4. **Secrets Management**
   - Use AWS Secrets Manager or HashiCorp Vault
   - Rotate database passwords quarterly
   - Never commit secrets to repository

5. **Access Control**
   - Restrict database port to app servers only
   - Use VPN for admin access
   - Implement IP whitelisting

## Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Verify credentials
psql -U postgres -d eabc_production -c "SELECT NOW();"

# Check connection pool
CONNECT_TIMEOUT=5 npm start
```

**High Memory Usage**
```bash
# Check for memory leaks
node --inspect server.js
# Open chrome://inspect

# Increase Node.js heap limit
node --max-old-space-size=4096 server.js
```

**Session State Lost**
```bash
# Verify Redis is running
redis-cli ping

# Check session store configuration
echo "REDIS_URL: $REDIS_URL"

# Clear sessions if corrupted
redis-cli FLUSHDB
```

## Support & Escalation

- **Bugs**: Create GitHub issue with reproduction steps
- **Performance**: Check /health endpoint and application logs
- **Security**: Email security@example.com
- **On-Call**: Setup PagerDuty for critical alerts

## Rollback Procedure

```bash
# If critical issues after deployment:

# 1. Check current version
git log --oneline -1

# 2. Rollback to previous commit
git checkout previous-stable-version

# 3. Restart application
sudo systemctl restart eabc

# 4. Verify health
curl http://localhost:3000/health

# 5. Investigate issue
grep -i error ./logs/error.log | tail -50
```

---

**Deployment Completed Successfully!** 🎉

Next steps:
1. Configure monitoring dashboards
2. Set up automated backups
3. Schedule security audits
4. Train operations team
