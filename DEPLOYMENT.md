# Deployment status

**Production deployment is not approved.** The older deployment examples in this file have been retired because they referenced an obsolete schema path, older Node.js versions, and infrastructure patterns that do not match the current application.

For the only currently supported deployment path, use:

- `STAGING_DEPLOYMENT.md` — isolated Render staging setup and smoke tests.
- `REMEDIATION_AUDIT.md` — verified findings, code changes and remaining blockers.
- `PRODUCTION_CHECKLIST.md` — mandatory production promotion gate.

The executable application entry point is `server.js` (`npm start`). Do not run `server-enterprise.js` or `src/server-enterprise.js`; they are legacy experimental implementations and are not the configured application entry point.

Do not deploy this code to Vercel. The current `server.js` explicitly rejects Vercel in staging/production because its required durable upload storage is not supported by that deployment mode.
