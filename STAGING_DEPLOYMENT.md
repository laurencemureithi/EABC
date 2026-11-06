# EABC staging deployment (Render)

This blueprint is for a **staging environment only**. It is not approval for customer production use.

## What it provisions
- One Render Node.js web service (Starter plan).
- Managed Render PostgreSQL in Frankfurt.
- A 5 GB persistent disk mounted at `/var/data`; uploads are stored under `/var/data/uploads`.
- Database migrations run first; an idempotent staging bootstrap then creates only the default `comp-001` company and configured administrator if they do not already exist. It inserts no demo assets, work orders, inventory or reports.
- A database-backed `/health` readiness probe.

## Before creating the Blueprint

**This is a staging-only deployment.** The current code is not approved for production or for unrelated customer tenants. The `WORKSPACE_SERIAL_GUARD` is temporary single-instance containment.

The repository does not yet contain an npm `package-lock.json`. `bun.lock` is not consumed by Render's `npm install` build command. Dependency installation is therefore not yet reproducible; do not promote this build to production. Generate and commit a valid npm lockfile after a successful dependency install, then switch the build command to `npm ci`.

1. Push the remediation branch to a private GitHub repository.
2. In Render, create a new Blueprint from that repository and select `render.yaml`.
3. Supply a unique administrator password of at least 12 characters when prompted for `ADMIN_LOGIN_PASSWORD`. Do not reuse the old demo password. The pre-deploy bootstrap uses it only when creating the initial admin record; it does not overwrite an existing password.
4. If running automated end-to-end tests, set `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` to the staging administrator credentials in the test runner environment. Never commit them.
5. Keep the database private to the Render service where possible.
6. Do not add a second web instance or enable horizontal scaling while `WORKSPACE_SERIAL_GUARD=true`. The current application still uses process-global active-workspace state.
7. Do not run `npm run db:seed`, `seed_production_database.js`, or `migrate_and_deduplicate.js` against this staging database. Those scripts are not part of the staging deployment path.

## Important staging limitations
- The application currently serializes business requests as a temporary containment for its global active-workspace state. This is intentionally conservative and will limit throughput.
- The guard does **not** replace a proper request-scoped tenant/data-access refactor. Do not onboard unrelated customer organizations or treat this as multi-tenant production approval.
- Render persistent disks are tied to a service instance and constrain horizontal scaling. Move uploads to private object storage before a horizontally scaled commercial release.
- Configure `GEMINI_API_KEY` in the Render dashboard if AI features are to be exercised.
- Configure SMTP secrets separately if email/reset workflows are to be tested.

## Automated staging verification

The end-to-end suites create and modify test organizations, users, assets, reports and documents. Run them **only against a disposable staging database** from an environment that can reach the private Render PostgreSQL network:

```bash
BASE_URL=https://<your-render-service>.onrender.com \
E2E_ADMIN_EMAIL=<staging-admin-email> \
E2E_ADMIN_PASSWORD=<staging-admin-password> \
npm run test:staging
```

Do not run this suite against production or a database containing customer records. The scripts need Node.js dependencies installed and access to the staging database because several checks query PostgreSQL directly.

## Staging smoke tests
1. Confirm `/health` returns HTTP 200 and reports PostgreSQL connected.
2. Sign in using the configured administrator credentials.
3. Confirm the `opsloom_user` cookie is `HttpOnly`, `Secure` on HTTPS, `SameSite=Lax`, and contains a signed expiring token rather than a raw user ID.
4. Confirm unsigned cookies and `/login/google` cannot authenticate.
5. Create a staging company, asset, breakdown, maintenance task and inventory part. Verify records remain after a service restart.
6. Upload a PDF and image; verify an unauthenticated request returns 401 and a user from another company cannot retrieve a file.
7. Test invalid file extensions, oversized uploads, failed DB connections and migration rollback/recovery.
8. Run all existing end-to-end suites against a disposable staging database. Never run destructive tests against production.

## Required environment variables
`NODE_ENV=staging`, `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `ADMIN_LOGIN_PASSWORD` (12+ characters), `ADMIN_PRIMARY_EMAIL`, `ALLOW_STAGING_BOOTSTRAP=true`, `UPLOADS_DIR=/var/data/uploads`, `WORKSPACE_SERIAL_GUARD=true`, and `TZ=Africa/Nairobi`.

Optional: `GEMINI_API_KEY` and SMTP variables.

## Promotion to production is blocked until
- Tenant access is request-scoped and enforced in every database query, not based on global mutable workspace state.
- Multi-company adversarial tests prove there is no cross-tenant read/write/document leakage.
- All mutating workflows await and verify database commits before success confirmations.
- KPI definitions and calculations are corrected and validated against known test datasets.
- Uploads move to private object storage with signed/authorized retrieval.
- Backup restoration, monitoring, load testing and incident recovery are demonstrated.
