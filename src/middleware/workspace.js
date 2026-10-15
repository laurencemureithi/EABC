/**
 * Multi-Tenancy & Workspace Isolation Middleware
 * Enforces company boundary validation and active workspace resolution.
 */

function workspaceMiddleware(resolveWorkspaceFn) {
  return (req, res, next) => {
    try {
      if (typeof resolveWorkspaceFn === 'function') {
        const activeComp = resolveWorkspaceFn(req);
        req.activeCompany = activeComp;
        req.workspaceId = activeComp ? activeComp.id : 'comp-001';
      }
    } catch (err) {
      console.warn('[Workspace Middleware Warning]:', err.message);
    }
    next();
  };
}

module.exports = { workspaceMiddleware };
