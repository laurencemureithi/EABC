# EABC remediation report — source audit update

**Review date:** 6 November 2026  
**Reviewed artifact:** `eabc-remediated-staging.zip`  
**Review scope:** application source, database access layer, migrations, security middleware, seed/migration scripts, deployment configuration, tests, documentation and bundled artifacts.

## Executive decision

**Staging only, after a disposable database is provisioned and the remaining runtime checks are completed. Not production-ready.**

The original archive contained a substantial amount of remediation work, but the code still had material security and operational gaps. The earlier statement that tenant helper tests passed was misleading: the test explicitly approved a caller-supplied company ID when no active tenant was bound. That behavior has now been changed to fail closed unless a trusted platform-admin scope is explicitly supplied.

## Changes applied in this audit pass

1. **Fail-closed tenant write helper**
   - `src/security/tenant-scope.js` now rejects writes when no verified company context exists.
   - Cross-company writes require the explicit `allowCrossTenant: true` authorization option.
   - The DAL derives that option from a trusted request flag set only after the main server authenticates the actor as a platform administrator.
   - The serialized request lane resets the privilege flag before each request and the authentication middleware sets it for the current authenticated platform-admin request only.

2. **Public report file protection**
   - Generated report paths under `/static/exports/reports` and `/exports/reports` now require an authenticated user and company ownership, with platform-admin access handled separately.
   - Twenty historical PDF exports containing Ultravetis operational report content were removed from the source archive.
   - Generated report PDFs are now ignored by Git.

3. **Redirect hardening**
   - Workspace and department navigation redirects now reject protocol-relative and external redirect targets.

4. **Upload input hardening**
   - Base64 asset photos are restricted to PNG/JPEG/WebP/GIF raster payloads, checked against their file signatures and capped at 25 MB. Company-logo data URLs also reject SVG and non-raster payloads. SVG is not written as a same-origin upload file.

5. **Credential hygiene**
   - End-to-end tests no longer fall back to the known `Admin@123` password. They require explicit `E2E_ADMIN_PASSWORD` or `ADMIN_LOGIN_PASSWORD`.
   - The legacy deduplication script no longer creates a default administrator password; imported plaintext passwords are hashed before insertion.
   - Password update and login-migration writes are scoped to the affected user's company; password update callers now await PostgreSQL persistence before reporting success.
   - Administrator recovery codes use a cryptographic random generator, reset requests/attempts are rate-limited, and the code is only reported as sent after SMTP delivery succeeds. SMTP certificate verification is enabled by default.

6. **Integration test corrections**
   - The section-22 scenario now verifies PostgreSQL as the authoritative source instead of reading the intentionally empty `data/datastore.json` file.
   - The profile-branding test now creates and cleans up a temporary company rather than overwriting the real `comp-001` brand/contact details; it no longer uses a hardcoded admin password.
   - E2E request helpers can target HTTPS staging URLs and require explicit administrator credentials.

7. **First-run staging bootstrap**
   - Added `scripts/bootstrap-staging.js`, which runs only with explicit staging environment flags.
   - The Render pre-deploy command now runs migrations followed by the idempotent bootstrap. It creates only the configured administrator and the existing default `comp-001` organization when absent; it inserts no sample business records and never overwrites an existing admin password.

8. **Demo seeder safety**
   - Development seed scripts require `NODE_ENV=development` and `ALLOW_DEMO_SEED=true`.
   - The legacy production-named seeder is explicitly blocked outside isolated local development and its orphan cleanup is restricted to `comp-001`.
   - The production checklist no longer claims the application is ready for production.

## Validation performed in this audit pass

| Check | Result | Notes |
|---|---|---|
| JavaScript syntax check | PASS | All 42 JavaScript files pass `node scripts/check-syntax.js`. |
| Security helper tests | PASS | Password hashing, signed sessions, tamper rejection, expiry, missing-tenant rejection and explicit privileged scope. |
| Main end-to-end suite | BLOCKED | `pg` is not installed in the review environment. |
| Full browser workflow tests | NOT RUN | Requires installed dependencies, a live app and a disposable PostgreSQL database. |
| PostgreSQL migrations | NOT RUN | No PostgreSQL instance/credentials were supplied. |
| Render Blueprint YAML | PASS | `render.yaml` parses; current Render plan IDs are documented and valid. |
| TypeScript project check | BLOCKED | `tsc --noEmit` fails because the separate Drizzle/Firebase TypeScript layer is missing runtime/type dependencies and Node typings; this is not the configured `server.js` runtime. |
| Tenant adversarial tests | NOT RUN | Requires at least two companies and users in a disposable database. |
| Upload/report access tests | NOT RUN | Requires a running app, database and test files across two tenants. |
| Dependency audit | NOT RUN | Network package installation did not complete; no npm lockfile is present. |

## Findings that remain open

### Critical / production blockers

- The main application still uses `global._currentCompanyId` and process-global store state. `WORKSPACE_SERIAL_GUARD=true` serializes requests on one process; it is not a request-scoped architecture and does not support horizontal scaling or serverless execution safely.
- The DAL has a mixture of tenant-filtered and unfiltered read/delete methods. Platform-wide operations must be reviewed route by route; the current helper change does not constitute proof of full tenant isolation.
- Several handlers still issue fire-and-forget or swallowed database writes. A complete write/transaction audit is still required.
- The current `database/migrations/0001_initial_schema.sql` uses `CREATE TABLE IF NOT EXISTS`; this does not upgrade older tables created by the legacy `database/schema.sql`. The second migration may fail against an old schema where `company_id` or newer columns are absent. Rehearse on a representative copy before migrating any existing database.
- The repository still lacks `package-lock.json`. A package-lock-only install attempt did not complete in this environment, and the main tests fail because `pg` is not installed. Render's `npm install` is not deterministic. Generate a lockfile, commit it and use `npm ci`.
- The repository contains a separate experimental TypeScript/Drizzle/Firebase data layer and two alternate server implementations. They are not wired into `npm start`; reconcile or remove them before treating the repository as one maintainable production architecture.
- KPI methodology and fallback/example metrics have not been independently validated against known datasets.
- Uploads remain on a service-attached persistent disk. Before production or multi-instance use, move to private object storage with authenticated retrieval.
- Helmet Content Security Policy remains disabled pending a nonce/hash migration.
- Backup/restore drills, monitoring, alerting, load tests, dependency vulnerability scanning and incident recovery have not been demonstrated.

### Operational notes

- The Render Blueprint uses valid current plan IDs (`0.5c-512mb` web service and `0.5c-1g` PostgreSQL), but infrastructure validity is not application readiness.
- The Render service and database are configured for Frankfurt. This is a deployment choice, not a code correctness issue; evaluate latency and data residency requirements before production.
- Do not connect live customer data to staging.
- `database/schema.sql` is a legacy schema snapshot and is not used by the current migration runner. Use only `database/migrations/*.sql` for a clean staging database.
- Do not run the legacy `migrate_and_deduplicate.js` script against a live database without a separately reviewed data migration plan, verified backup and disposable rehearsal.

## Promotion rule

Keep this branch as a staging candidate only. Production approval requires evidence that every blocker above is closed and all existing modules pass functional acceptance testing.
