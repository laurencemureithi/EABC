/**
 * PRODUCTION CHECKLIST & DEPLOYMENT GUIDE
 * Follow these steps to deploy EABC enterprise edition
 */

# 🚀 EABC Enterprise Deployment Checklist

## Pre-Deployment Setup

### 1. Environment Configuration
- [ ] Copy `.env.example` to `.env.production`
- [ ] Set all required PostgreSQL credentials
- [ ] Generate strong SESSION_SECRET (32+ chars): `openssl rand -base64 32`
- [ ] Verify NODE_ENV is set to 'production'
- [ ] Set correct database host/port (use Cloud SQL public IP or private DNS)

### 2. Database Setup
```bash
# Connect to PostgreSQL
psql postgresql://<user>:<password>@<host>:<port>/<database>

# Run migrations (copy contents from database/migrations.js)
# Execute each CREATE TABLE statement in order
# Verify all tables created: \dt
```

### 3. Dependencies Installation
```bash
# Install only production dependencies
npm ci --only=production

# Verify no vulnerabilities
npm audit --audit-level=moderate

# List installed packages
npm list --depth=0
```

## Security Hardening

### 4. SSL/TLS Certificates
- [ ] Obtain SSL certificate (Let's Encrypt or CA)
- [ ] Configure certificate path in reverse proxy (nginx/Apache)
- [ ] Enable HSTS headers (already configured in app)
- [ ] Test SSL: `nmap --script ssl-enum-ciphers -p 443 yourdomain.com`

### 5. Network Security
- [ ] Restrict PostgreSQL port (5432) to app server only
- [ ] Use VPC/Security Groups to limit access
- [ ] Whitelist admin IPs if using VPN
- [ ] Disable root login on database
- [ ] Create dedicated app database user with limited privileges

### 6. Application Security
- [ ] Review all environment variables are NOT hardcoded
- [ ] Confirm SESSION_SECRET is strong and unique
- [ ] Implement rate limiting (already configured: 100 req/15min)
- [ ] Set up WAF (AWS WAF, Cloudflare, ModSecurity)
- [ ] Enable CORS only for trusted domains

## Deployment

### 7. Choose Deployment Method

**Option A: Traditional Server (VPS)**
```bash
# 1. SSH to server
ssh ubuntu@your-server.com

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Clone repository
git clone https://github.com/laurencemureithi/EABC.git
cd EABC
git checkout enterprise-deployment-v1

# 4. Install dependencies
npm ci --only=production

# 5. Create systemd service (see DEPLOYMENT.md for full config)
sudo systemctl start eabc
sudo systemctl enable eabc

# 6. Configure reverse proxy (nginx)
# See nginx configuration below
```

**Option B: Docker**
```bash
# 1. Build image
docker build -t eabc:v1 .

# 2. Run container
docker run -d \
  --name eabc \
  -p 3000:3000 \
  --env-file .env.production \
  eabc:v1

# 3. Test
curl http://localhost:3000/health
```

**Option C: Kubernetes**
```bash
# See DEPLOYMENT.md for full K8s manifests
kubectl apply -f k8s/deployment.yaml
kubectl get pods
```

### 8. Reverse Proxy Configuration (Nginx)

```nginx
upstream eabc_app {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name eabc.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name eabc.yourdomain.com;

    ssl_certificate /etc/ssl/certs/yourdomain.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 10M;

    location / {
        proxy_pass http://eabc_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

## Post-Deployment Verification

### 9. Health Check
```bash
# Health endpoint
curl -s https://eabc.yourdomain.com/health | jq .

# Expected response:
# {
#   "ok": true,
#   "data": {
#     "status": "healthy",
#     "database": "connected",
#     "memory": { ... }
#   }
# }
```

### 10. Test Core Workflows

**Login Test**
```bash
curl -X POST https://eabc.yourdomain.com/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@example.com&password=yourpassword" \
  -c cookies.txt
```

**Asset Creation Test**
```bash
curl -X POST https://eabc.yourdomain.com/api/assets \
  -H "Content-Type: application/json" \
  -H "Cookie: $(cat cookies.txt)" \
  -d '{
    "asset_id": "TEST-001",
    "asset_name": "Test Machine",
    "category": "Packaging Machinery",
    "section": "Packaging",
    "location": "Bay 1"
  }'
```

**Workspace Isolation Test**
```bash
# Try to access another company's data (should fail)
curl https://eabc.yourdomain.com/api/assets?company_id=other-company \
  -H "Cookie: $(cat cookies.txt)"

# Expected: 403 Access denied
```

### 11. Audit Trail Verification
```bash
# Check that all actions are logged
psql -U postgres -d eabc_production -c "
  SELECT timestamp, action, entity_type, severity FROM audit_trail 
  ORDER BY timestamp DESC LIMIT 20;
"
```

### 12. Monitoring Setup

**Log File Locations**
```bash
# Error logs
tail -f ./logs/error.log

# Info logs
tail -f ./logs/info.log

# Monitor in real-time
watch -n 1 'tail -20 ./logs/error.log'
```

**Set Up Alerts (Example: Grafana)**
- Alert on `/health` endpoint returning unhealthy status
- Alert on HTTP 5xx errors exceeding threshold
- Alert on database connection failures
- Alert on high memory usage (>80% heap)

## Production Operations

### 13. Backup Strategy

**Daily PostgreSQL Backup**
```bash
# Add to crontab (run at 2 AM daily)
0 2 * * * pg_dump -U postgres eabc_production | gzip > /backups/eabc-$(date +\%Y\%m\%d).sql.gz

# Backup to S3
0 3 * * * aws s3 cp /backups/eabc-$(date +\%Y\%m\%d).sql.gz s3://your-backup-bucket/

# Cleanup old backups (keep 30 days)
0 4 * * * find /backups -name "eabc-*.sql.gz" -mtime +30 -delete
```

**Test Restore**
```bash
# Monthly restore test (critical!)
gzip -d < /backups/latest-backup.sql.gz | psql -U postgres -d eabc_test
```

### 14. Performance Optimization

- [ ] Enable database query logging for slow queries
- [ ] Set up read replicas for dashboard/reporting queries
- [ ] Implement caching (Redis) for frequently accessed data
- [ ] Use CDN for static assets
- [ ] Configure database indexes for common queries

### 15. Scaling

**For High Traffic (>1000 req/sec)**
- [ ] Switch to Redis for session store (not memory)
- [ ] Increase database connection pool (pool_size > 20)
- [ ] Deploy multiple app instances behind load balancer
- [ ] Use read replicas for database queries
- [ ] Implement query result caching

## Rollback Procedure

### 16. If Issues Occur

```bash
# Check current version
git log --oneline -1

# Rollback to previous version
git checkout previous-stable-commit

# Restart app
sudo systemctl restart eabc

# Verify health
curl http://localhost:3000/health

# Check logs for errors
tail -50 ./logs/error.log
```

## Maintenance Schedule

- [ ] **Weekly**: Review error logs, check disk space
- [ ] **Monthly**: Run backup restore test, security audit
- [ ] **Quarterly**: Update dependencies, security patches
- [ ] **Annually**: Full penetration test, disaster recovery drill

## Support & Escalation

- **On-Call**: Setup PagerDuty for critical alerts
- **Bugs**: Create GitHub issue with reproduction steps
- **Performance**: Check `/health` endpoint and logs
- **Security**: Email security@example.com

---

**Deployment Status**: ✅ READY FOR PRODUCTION

Once all checklist items are complete, your EABC instance is production-ready and enterprise-grade.
