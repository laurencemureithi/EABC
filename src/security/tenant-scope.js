'use strict';

/**
 * Resolve the company boundary for a write.
 *
 * A missing active company is not an implicit platform-wide permission.
 * Cross-company writes require an explicit trusted authorization flag supplied
 * by the authenticated platform-admin request context.
 */
function tenantCompanyId(
  requestedCompanyId,
  activeCompanyId = global._currentCompanyId || null,
  entity = 'record',
  options = {}
) {
  const requested = requestedCompanyId == null || requestedCompanyId === ''
    ? null
    : String(requestedCompanyId);
  const active = activeCompanyId == null || activeCompanyId === ''
    ? null
    : String(activeCompanyId);

  if (active) {
    if (requested && requested !== active) {
      const error = new Error(`Cross-organization ${entity} access was blocked.`);
      error.code = 'TENANT_SCOPE_VIOLATION';
      throw error;
    }
    return active;
  }

  if (options.allowCrossTenant === true && requested) return requested;

  const error = new Error(`A verified organization context is required to write this ${entity}.`);
  error.code = 'TENANT_SCOPE_MISSING';
  throw error;
}

module.exports = { tenantCompanyId };
