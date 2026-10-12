/**
 * WORKSPACE ISOLATION MIDDLEWARE
 * Enforces company_id boundaries on every protected request
 * SECURITY CRITICAL - must be applied to all protected routes
 */

const logger = require('../utils/logger');

/**
 * Validate that request company_id matches user's authorized company
 */
function validateWorkspaceIsolation(req, res, next) {
  // Extract company_id from request (query, body, or session)
  const requestedCompanyId = 
    req.query.company_id || 
    req.body.company_id || 
    req.session?.company_id;
  
  const userCompanyId = req.session?.company_id;
  const userRole = req.session?.role;
  
  // Admin can access any workspace if explicitly switching
  if (userRole === 'administrator' && requestedCompanyId) {
    // Allow switch
    req.session.company_id = requestedCompanyId;
    return next();
  }
  
  // Regular users must have company_id in session
  if (!userCompanyId) {
    logger.warn('Request without company_id binding', {
      ip: req.ip,
      userId: req.session?.user_id,
      path: req.path
    });
    return res.status(401).json({
      ok: false,
      error: 'No workspace context - must log in with workspace assignment'
    });
  }
  
  // If specific company_id requested, verify it matches user's company
  if (requestedCompanyId && requestedCompanyId !== userCompanyId) {
    logger.error('SECURITY: Cross-workspace access attempt', {
      ip: req.ip,
      userId: req.session.user_id,
      userCompanyId,
      requestedCompanyId,
      path: req.path
    });
    return res.status(403).json({
      ok: false,
      error: 'Access denied - cannot access other workspaces'
    });
  }
  
  // Inject company_id into request object for use in handlers
  req.workspace = {
    company_id: userCompanyId,
    verified: true
  };
  
  next();
}

/**
 * Validate company_id ownership for specific resources
 * Usage: await validateResourceOwnership(req, db, 'assets', assetId)
 */
async function validateResourceOwnership(req, db, tableName, resourceId) {
  const result = await db.query(
    `SELECT company_id FROM ${tableName} WHERE id = $1 LIMIT 1`,
    [resourceId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Resource not found: ${tableName}/${resourceId}`);
  }
  
  const resourceCompanyId = result.rows[0].company_id;
  
  if (resourceCompanyId !== req.workspace.company_id) {
    logger.error('SECURITY: Resource ownership violation', {
      ip: req.ip,
      userId: req.session.user_id,
      userCompanyId: req.workspace.company_id,
      resourceCompanyId,
      resource: `${tableName}/${resourceId}`
    });
    throw new Error(`Unauthorized access to ${tableName}/${resourceId}`);
  }
  
  return true;
}

/**
 * Enforce company_id on query results
 * Strips any records not belonging to user's workspace
 */
function enforceCompanyIdOnResults(records, req) {
  if (!Array.isArray(records)) return records;
  
  return records.filter(record => {
    if (!record.company_id) {
      logger.warn('Record missing company_id', { record });
      return false;
    }
    if (record.company_id !== req.workspace.company_id) {
      logger.warn('Filtering out cross-workspace record', {
        recordCompanyId: record.company_id,
        userCompanyId: req.workspace.company_id
      });
      return false;
    }
    return true;
  });
}

module.exports = {
  validateWorkspaceIsolation,
  validateResourceOwnership,
  enforceCompanyIdOnResults
};
