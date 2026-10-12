/**
 * ASSETS DATA ACCESS LAYER
 * Handles machinery/equipment registry operations
 */

const BaseDAL = require('./base-dal');
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class AssetsDAL extends BaseDAL {
  constructor() {
    super('assets');
  }

  /**
   * Create asset in specified company workspace
   */
  async createAsset(companyId, data) {
    const id = uuidv4();
    
    // Verify asset_id uniqueness within company
    const existing = await db.query(
      'SELECT id FROM assets WHERE company_id = $1 AND asset_id = $2',
      [companyId, data.asset_id]
    );
    
    if (existing.rows.length > 0) {
      throw new Error(`Asset ID '${data.asset_id}' already exists in this workspace`);
    }
    
    const result = await db.query(
      `INSERT INTO assets 
       (id, company_id, asset_id, asset_name, category, section, status, 
        criticality, location, department, manufacturer, model_number, serial_number, 
        asset_value, power_rating, installation_date, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
       RETURNING *`,
      [
        id, companyId, data.asset_id, data.asset_name, data.category, data.section,
        data.status || 'operational', data.criticality || 'B', data.location,
        data.department || null, data.manufacturer || null, data.model_number || null,
        data.serial_number || null, data.asset_value || null, data.power_rating || null,
        data.installation_date || null, data.notes || null
      ]
    );
    
    return result.rows[0];
  }

  /**
   * Get asset with full maintenance history
   */
  async getAssetWithHistory(id, companyId) {
    const asset = await this.getById(id, companyId);
    if (!asset) return null;
    
    // Get recent breakdowns
    const breakdownsResult = await db.query(
      `SELECT id, incident_title, severity, status, created_at, resolved_at 
       FROM breakdowns 
       WHERE asset_id = $1 AND company_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 10`,
      [id, companyId]
    );
    
    // Get scheduled maintenance
    const maintenanceResult = await db.query(
      `SELECT id, task_description, status, scheduled_date, completed_date
       FROM maintenance_tasks
       WHERE asset_id = $1 AND company_id = $2 AND deleted_at IS NULL
       ORDER BY scheduled_date DESC LIMIT 10`,
      [id, companyId]
    );
    
    return {
      ...asset,
      recent_breakdowns: breakdownsResult.rows,
      scheduled_maintenance: maintenanceResult.rows
    };
  }

  /**
   * Update asset status (triggers cascading updates)
   */
  async updateStatus(id, companyId, newStatus) {
    const validStatuses = ['operational', 'degraded', 'out_of_service', 'under_maintenance'];
    
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    
    const result = await db.query(
      `UPDATE assets 
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId, newStatus]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Asset not found or unauthorized');
    }
    
    return result.rows[0];
  }

  /**
   * Get all assets by criticality class
   */
  async getByClass(companyId, criticality) {
    const result = await db.query(
      `SELECT * FROM assets 
       WHERE company_id = $1 AND criticality = $2 AND deleted_at IS NULL
       ORDER BY asset_name ASC`,
      [companyId, criticality]
    );
    
    return result.rows;
  }

  /**
   * Get asset reliability metrics (MTBF, MTTR)
   */
  async getReliabilityMetrics(id, companyId, daysBack = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    const result = await db.query(
      `SELECT
        COUNT(DISTINCT CASE WHEN status = 'resolved' THEN id END) as total_breakdowns,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 2) as avg_mttr_hours,
        ROUND(MIN(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 2) as min_repair_hours,
        ROUND(MAX(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 2) as max_repair_hours,
        COUNT(CASE WHEN severity = 'Critical' THEN 1 END) as critical_incidents
       FROM breakdowns
       WHERE asset_id = $1 AND company_id = $2 AND created_at >= $3 AND deleted_at IS NULL`,
      [id, companyId, cutoffDate]
    );
    
    return result.rows[0] || {};
  }
}

module.exports = new AssetsDAL();
