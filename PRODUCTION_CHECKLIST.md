# EABC production promotion gate

> **Status: NOT APPROVED FOR PRODUCTION.** This document intentionally replaces the earlier checklist that incorrectly described the project as production-ready.

The current application still relies on process-global active-workspace state. The `WORKSPACE_SERIAL_GUARD=true` setting is a temporary single-instance staging containment mechanism, not a multi-tenant production architecture.

## Allowed next step

Deploy only to an isolated, disposable **staging** environment using `STAGING_DEPLOYMENT.md`. Do not connect live customer data, production credentials, or the existing Ultravetis database.

## Mandatory blockers before production

- [ ] Replace process-global workspace state with request-scoped tenant context across every route and data-access method.
- [ ] Enforce tenant ownership in SQL reads, updates, deletes, document downloads and background tasks.
- [ ] Run adversarial multi-company tests proving no cross-tenant reads, writes, exports or file access.
- [ ] Audit every write path: await database operations, use transactions where needed, and return success only after commit.
- [ ] Validate all database migrations against both a clean database and a representative copy of the legacy schema.
- [ ] Add and commit a reproducible npm lockfile; deploy with `npm ci`.
- [ ] Validate KPI definitions and calculations against known, independently calculated test datasets; remove unsupported fallback/example metrics.
- [ ] Move uploads and generated documents to private object storage with authorization on every retrieval.
- [ ] Migrate from disabled CSP to a nonce/hash-based Content Security Policy.
- [ ] Complete dependency vulnerability scanning, secret scanning, backup/restore drills, monitoring, alerting, load testing and incident response exercises.
- [ ] Complete browser-based acceptance tests for all existing working modules and workflows.

## Operational warnings

- `npm run db:seed` is for isolated local development only and requires `NODE_ENV=development` plus `ALLOW_DEMO_SEED=true`.
- `seed_production_database.js` is a legacy demo seeder. It inserts fabricated sample assets and is blocked outside explicitly opted-in local development.
- Do not run `migrate_and_deduplicate.js` against a live database without a separately reviewed migration plan, a verified backup and a disposable rehearsal.
- The files under `static/exports/reports` are generated artifacts, not source code. Do not commit real company reports or uploaded customer documents.
- Render's current Blueprint plan IDs in `render.yaml` are valid, but a valid infrastructure file does not prove that application security or data integrity is production-ready.

Production approval requires evidence for every checkbox above, not merely a successful deployment or a green health endpoint.
