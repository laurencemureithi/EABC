/**
 * COMPANIES DATA ACCESS LAYER
 * Handles workspace/organization operations
 */

const BaseDAL = require('./base-dal');
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class CompaniesDAL extends BaseDAL {
  constructor() {
    super('companies');
  }

  /**
   * Create new workspace with branding configuration
   */
  async createWorkspace(data) {
    const id = uuidv4();
    
    // Verify code uniqueness across all workspaces (including soft-deleted)
    const existing = await db.query(
      'SELECT id FROM companies WHERE code = $1',
      [data.code.toUpperCase()]
    );
    
    if (existing.rows.length > 0) {
      throw new Error(`Workspace code '${data.code}' already exists`);
    }
    
    const result = await db.query(
      `INSERT INTO companies 
       (id, name, code, industry, contact_email, contact_phone, currency, 
        primary_color, secondary_color, logo_light, logo_dark, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING *`,
      [
        id,
        data.name,
        data.code.toUpperCase(),
        data.industry || null,
        data.contact_email || null,
        data.contact_phone || null,
        data.currency || 'USD',
        data.primary_color || '#2563eb',
        data.secondary_color || '#f59e0b',
        data.logo_light || null,
        data.logo_dark || null
      ]
    );
    
    return result.rows[0];
  }

  /**
   * Get workspace by code (public endpoint, safe)
   */
  async getByCode(code) {
    const result = await db.query(
      'SELECT * FROM companies WHERE code = $1 AND deleted_at IS NULL LIMIT 1',
      [code.toUpperCase()]
    );
    
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * List all active workspaces for admin
   */
  async listActive(limit = 100, offset = 0) {
    const result = await db.query(
      'SELECT id, name, code, industry, created_at, updated_at FROM companies WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    
    return result.rows;
  }

  /**
   * Count active assets in workspace
   */
  async countAssets(companyId) {
    const result = await db.query(
      'SELECT COUNT(*) as count FROM assets WHERE company_id = $1 AND deleted_at IS NULL',
      [companyId]
    );
    
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Count active breakdowns in workspace
   */
  async countBreakdowns(companyId) {
    const result = await db.query(
      'SELECT COUNT(*) as count FROM breakdowns WHERE company_id = $1 AND deleted_at IS NULL',
      [companyId]
    );
    
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Workspace dashboard statistics
   */
  async getStats(companyId) {
    const result = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM assets WHERE company_id = $1 AND deleted_at IS NULL) as total_assets,
        (SELECT COUNT(*) FROM assets WHERE company_id = $1 AND status = 'operational' AND deleted_at IS NULL) as operational_assets,
        (SELECT COUNT(*) FROM breakdowns WHERE company_id = $1 AND status IN ('new', 'assigned', 'in_progress') AND deleted_at IS NULL) as active_breakdowns,
        (SELECT COUNT(*) FROM maintenance_tasks WHERE company_id = $1 AND status = 'overdue' AND deleted_at IS NULL) as overdue_tasks,
        (SELECT SUM(qty * unit_price) FROM inventory_parts WHERE company_id = $1 AND deleted_at IS NULL) as inventory_value
      `,
      [companyId]
    );
    
    return result.rows[0];
  }
}

module.exports = new CompaniesDAL();
