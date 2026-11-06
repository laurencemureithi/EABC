# GitHub and managed deployment

**Use Render only for an isolated staging deployment at this stage. Production and Vercel deployments are not approved.**

## Before deployment

1. Push the reviewed remediation branch to the private EABC GitHub repository.
2. Keep the repository private; it contains project implementation details and historical company-specific material may have existed in earlier archives.
3. Confirm that generated reports, uploads, `.env` files and credentials are not committed.
4. Review `REMEDIATION_AUDIT.md` and `STAGING_DEPLOYMENT.md`.

## Render staging

Follow the exact steps in `STAGING_DEPLOYMENT.md` and use the root `render.yaml` Blueprint.

The Blueprint provisions a single web service and a managed PostgreSQL database in Frankfurt. Keep the database private. Use a unique staging administrator password and a newly generated session secret. Do not connect the existing Ultravetis production database or import live customer records.

## Important limitations

- The main server is `server.js`.
- `WORKSPACE_SERIAL_GUARD=true` is required for the current single-instance staging containment. Do not add a second instance or enable horizontal scaling.
- The application still requires a request-scoped tenant/data-access refactor and full adversarial testing before it can be marketed as a multi-tenant SaaS.
- `package-lock.json` is not yet present. Generate and commit it after dependency installation succeeds, then use `npm ci`.
- Do not run demo seeders or legacy data migration scripts against staging or production.
- A green Render deploy or `/health` response is not production approval.

## Promotion

Use `PRODUCTION_CHECKLIST.md`. Every mandatory blocker must be closed with test evidence before production.
