# EABC / Opsloom codebase remediation report

**Release status: staging candidate only — NOT approved for customer production.**

## Work completed in this pass

### Authentication and session integrity
- Added a standalone security module using Node.js `scrypt` password hashing with per-password random salts.
- Added one-time legacy plaintext-password verification followed by hash migration after successful login.
- Replaced the raw `opsloom_user` ID cookie with an HMAC-SHA256 signed, expiring token.
- Made the authentication cookie `HttpOnly`, `SameSite=Lax`, and `Secure` when served over HTTPS.
- Rejected unsigned legacy user-ID cookies.
- Disabled the legacy `/login/google` route that previously granted a fixed administrator identity without verifying Google identity.
- Removed the unauthenticated company-brand save exception.
- Required unique administrator bootstrap credentials and a 32+ character session secret in staging/production.
- Added per-IP login throttling and API rate limiting.
- Added same-origin validation for state-changing browser requests.

### Tenant and database controls
- Added a tenant-scope guard for DAL writes.
- Made common DAL collection reads and destructive operations default to the authenticated active tenant. Explicit `null` scope is reserved for trusted full-database synchronization/platform administration.
- Restricted company switching, company creation/deletion, company branding, user provisioning and user administration to the platform administrator or the user's assigned organization as appropriate.
- Scoped AI telemetry, saved AI chats, notifications, internal messages, reports, recycle-bin data, audit views, technician views and key asset/maintenance routes.
- Removed a dangerous empty-asset fallback that could display every tenant's assets.
- Removed several success/detail fallbacks that silently displayed another record when a requested record was missing.
- Added a temporary serialized-request guard because the existing application still uses process-global active-workspace state. Staging/production startup requires `WORKSPACE_SERIAL_GUARD=true`.
- Made database synchronization failures fail closed in staging/production.
- Added a persistence-failure flag so a failed settings write blocks subsequent staging/production requests pending investigation.
- Added a tenant-data audit script to identify null/orphan company IDs, duplicate login emails and broken asset links.

### Uploads and HTTP security
- Rejected Vercel and `/tmp` upload storage in staging/production.
- Added a configurable durable `UPLOADS_DIR` requirement.
- Added authentication and tenant ownership checks before uploaded files are served.
- Added a file-extension allowlist and a 25 MB per-file limit (maximum 10 files per request).
- Added Helmet security headers, disabled `X-Powered-By`, and configured HSTS for HTTPS staging/production.
- Suppressed raw internal error messages in staging/production responses.

### Deployment preparation
- Added `render.yaml` for a managed Render staging environment with a same-region managed PostgreSQL database, private database network access, pre-deploy migrations and a persistent upload disk.
- Added `STAGING_DEPLOYMENT.md` with environment variables, rollout sequence and smoke-test instructions.
- Updated `.env.example` so it no longer contains the old default administrator password.
- Added `test:security`, `test:staging`, `db:audit` and expanded lint scripts.
- Updated existing end-to-end tests to accept staging administrator credentials through environment variables.

## Validation actually performed

| Check | Result | Notes |
|---|---|---|
| JavaScript syntax across project | PASS | All 42 `.js` files passed `node --check` through `scripts/check-syntax.js`. |
| `npm run lint` | PASS | Server, DAL and security modules passed syntax checks. |
| `npm run test:security` | PASS | Password hashing, legacy migration verification, signed sessions, tamper rejection, expiry and tenant-scope helper tests passed. |
| `npm test` | BLOCKED | `pg` dependency is not installed in this environment. |
| Dependency installation | BLOCKED | `npm install` could not complete in this environment; package-lock generation was not completed. |
| PostgreSQL migrations | NOT RUN | No live staging database or installed `pg` package was available. |
| Multi-company adversarial tests | NOT RUN | Requires a populated disposable PostgreSQL database and full runtime dependencies. |
| Browser workflow tests | NOT RUN | Requires installed dependencies, a running server and database. |
| Upload privacy tests | NOT RUN | Requires a running staging service and multiple test organizations. |

## Important limitations that remain

1. **The legacy global workspace architecture is not fully eliminated.** The serialized-request guard is a temporary single-instance containment, not a scalable replacement for request-scoped tenant context. Do not add instances or onboard unrelated customer organizations until this is fully refactored and adversarially tested.
2. **Tenant scoping is not yet proven across every route.** The DAL and major routes have been hardened, but a full route-by-route authorization test is still required. The `db:audit` script must be run against the actual database before any data migration or customer onboarding.
3. **Some route handlers still catch DAL write errors and continue.** A complete transaction/commit audit is required so that success confirmations are emitted only after durable commits.
4. **KPI methodology and AI fallback content still require a separate remediation pass.** Existing hardcoded example metrics and invalid assumptions must be removed or recalculated from company data before a business owner relies on them.
5. **Persistent disk uploads are suitable only as a controlled single-instance staging step.** Before horizontal scaling or commercial multi-tenant production, move documents to private object storage with authenticated/signed retrieval and a migration plan.
6. **Content Security Policy is disabled in Helmet** because the existing templates contain inline scripts/styles. A nonce/hash-based CSP migration is still required.
7. **A reproducible npm lockfile is still required.** Generate and commit `package-lock.json` after dependency installation succeeds; then change the Render build command from `npm install` to `npm ci`.
8. **Backups and restore drills, monitoring/alerting, load testing, dependency vulnerability scanning, and incident recovery have not been demonstrated.**

## Staging environment

The supplied Render Blueprint is a starting configuration, not a completed deployment. It provisions a Frankfurt web service and PostgreSQL database, with the database restricted to private network connections and a 5 GB persistent disk mounted at `/var/data`.

Required staging environment variables:
- `NODE_ENV=staging`
- `DATABASE_URL`
- `SESSION_SECRET` (32+ random characters)
- `ADMIN_LOGIN_PASSWORD` (unique, 12+ characters)
- `UPLOADS_DIR=/var/data/uploads`
- `WORKSPACE_SERIAL_GUARD=true`
- `TZ=Africa/Nairobi`

Optional: `GEMINI_API_KEY`, SMTP credentials, and `ADMIN_PRIMARY_EMAIL`.

After deploying, run `npm run db:audit`, then run the staging smoke tests in `STAGING_DEPLOYMENT.md`. Do not connect live customer data to this staging instance.

## Promotion gate

EABC must remain in staging until the outstanding limitations above are closed, especially tenant isolation, write/commit semantics, KPI correctness, private object storage, database backup/restore and reproducible full-suite tests. The project is not yet ready to be sold as a production SaaS platform.
