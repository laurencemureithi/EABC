'use strict';

function tenantCompanyId(requestedCompanyId, activeCompanyId = global._currentCompanyId || null, entity = 'record') {
  if (activeCompanyId && requestedCompanyId && String(requestedCompanyId) !== String(activeCompanyId)) {
    const error = new Error(`Cross-organization ${entity} access was blocked.`);
    error.code = 'TENANT_SCOPE_VIOLATION';
    throw error;
  }
  return activeCompanyId || requestedCompanyId || 'comp-001';
}

module.exports = { tenantCompanyId };
