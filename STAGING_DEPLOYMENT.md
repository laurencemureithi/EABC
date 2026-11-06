# EABC staging deployment (Render)

This blueprint is for a **staging environment only**. It is not approval for customer production use.

## What it provisions
- One Render Node.js web service (Starter plan).
- Managed Render PostgreSQL in Frankfurt.
- A 5 GB persistent disk mounted at `/var/data`; uploads are stored under `/var/data/uploads`.
- Database migrations run as the pre-deploy command.
- A database-backed `/health` readiness probe.

## Before creating the Blueprint
1. Push the remediation branch to a private GitHub repository.
2. In Render, create a new Blueprint from that repository and select `render.yaml`.
3. Supply a unique administrator password of at least 12 characters when prompted for `ADMIN_LOGIN_PASSWORD`. Do not reuse the old demo password.
4. If running automated end-to-end tests, set `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` to the staging administrator credentials in the test runner environment. Never commit them.
5. Keep the database private to the Render service where possible.
6. Do not add a second web instance or enable horizontal scaling while `WORKSPACE_SERIAL_GUARD=true`. The current application still uses process-global active-workspace state.

## Important staging limitations
- The application currently serializes business requests as a temporary containment for its global active-workspace state. This is intentionally conservative and will limit throughput.
- The guard does **not** replace a proper request-scoped tenant/data-access refactor. Do not onboard unrelated customer organizations or treat this as multi-tenant production approval.
- Render persistent disks are tied to a service instance and constrain horizontal scaling. Move uploads to private object storage before a horizontally scaled commercial release.
- Configure `GEMINI_API_KEY` in the Render dashboard if AI features are to be exercised.
- Configure SMTP secrets separately if email/reset workflows are to be tested.

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
`NODE_ENV=staging`, `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `ADMIN_LOGIN_PASSWORD` (12+ characters), `UPLOADS_DIR=/var/data/uploads`, `WORKSPACE_SERIAL_GUARD=true`, and `TZ=Africa/Nairobi`.

Optional: `GEMINI_API_KEY`, SMTP variables, and `ADMIN_PRIMARY_EMAIL`.

## Promotion to production is blocked until
- Tenant access is request-scoped and enforced in every database query, not based on global mutable workspace state.
- Multi-company adversarial tests prove there is no cross-tenant read/write/document leakage.
- All mutating workflows await and verify database commits before success confirmations.
- KPI definitions and calculations are corrected and validated against known test datasets.
- Uploads move to private object storage with signed/authorized retrieval.
- Backup restoration, monitoring, load testing and incident recovery are demonstrated.
