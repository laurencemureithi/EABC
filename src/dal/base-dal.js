/**
 * BASE DATA ACCESS LAYER (DAL)
 * Centralized, company-aware database operations
 * All data access MUST go through this layer
 */

const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class BaseDAL {
  constructor(tableName) {
    this.tableName = tableName;
  }

  /**
   * Validate company_id ownership (security critical)
   */
  async validateCompanyOwnership(recordId, companyId, idColumn = 'id') {
    const result = await db.query(
      `SELECT company_id FROM ${this.tableName} WHERE ${idColumn} = $1 LIMIT 1`,
      [recordId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Record not found: ${recordId}`);
    }
    
    if (result.rows[0].company_id !== companyId) {
      throw new Error(`SECURITY: Access denied - company mismatch for ${this.tableName}/${recordId}`);
    }
    
    return result.rows[0];
  }

  /**
   * Create a new record with automatic company_id binding
   */
  async create(companyId, data) {
    if (!companyId) throw new Error('company_id is required for create operation');
    
    const id = data.id || uuidv4();
    const timestamp = new Date();
    
    const columns = [
      'id', 'company_id', 'created_at', ...Object.keys(data).filter(k => k !== 'id')
    ];
    const values = [
      id, companyId, timestamp, ...Object.values(data).filter((v, i) => Object.keys(data)[i] !== 'id')
    ];
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await db.query(
      `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    
    return result.rows[0];
  }

  /**
   * Get record by ID with company_id validation
   */
  async getById(id, companyId, idColumn = 'id') {
    const result = await db.query(
      `SELECT * FROM ${this.tableName} WHERE ${idColumn} = $1 AND company_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [id, companyId]
    );
    
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * List records for company with pagination
   */
  async listByCompany(companyId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = 'created_at DESC',
      where = '',
      includeSoftDeleted = false
    } = options;
    
    if (limit > 1000) throw new Error('Limit cannot exceed 1000 rows');
    
    const softDeleteFilter = includeSoftDeleted ? '' : 'AND deleted_at IS NULL';
    const whereClause = where ? `AND ${where}` : '';
    
    const result = await db.query(
      `SELECT * FROM ${this.tableName} 
       WHERE company_id = $1 ${softDeleteFilter} ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );
    
    return result.rows;
  }

  /**
   * Update record with company_id validation and change tracking
   */
  async update(id, companyId, data, idColumn = 'id') {
    if (!companyId) throw new Error('company_id is required for update operation');
    
    // Verify ownership first
    await this.validateCompanyOwnership(id, companyId, idColumn);
    
    const updates = Object.entries(data)
      .map(([key, value], i) => `${key} = $${i + 2}`)
      .join(', ');
    
    if (!updates) return null;
    
    const values = [id, ...Object.values(data), new Date()];
    
    const result = await db.query(
      `UPDATE ${this.tableName} 
       SET ${updates}, updated_at = $${Object.keys(data).length + 2}
       WHERE ${idColumn} = $1 AND company_id = $${Object.keys(data).length + 3}
       RETURNING *`,
      [id, ...Object.values(data), new Date(), companyId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Update failed: record not found or unauthorized`);
    }
    
    return result.rows[0];
  }

  /**
   * Soft delete - marks record as deleted without removing it
   */
  async softDelete(id, companyId, deletedBy, idColumn = 'id') {
    if (!companyId) throw new Error('company_id is required for delete operation');
    
    // Get record before deletion for audit
    const record = await this.validateCompanyOwnership(id, companyId, idColumn);
    
    // Mark as deleted
    const result = await db.query(
      `UPDATE ${this.tableName}
       SET deleted_at = NOW(), deleted_by = $3
       WHERE ${idColumn} = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId, deletedBy]
    );
    
    // Move to recycle bin
    await db.query(
      `INSERT INTO recycle_bin (id, company_id, primary_id, entity_type, entity_data, deleted_by, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (primary_id, entity_type) DO UPDATE SET entity_data = $5`,
      [
        uuidv4(),
        companyId,
        id,
        this.tableName.replace('s', '').toUpperCase(),
        JSON.stringify(record),
        deletedBy
      ]
    );
    
    return result.rows[0];
  }

  /**
   * Hard delete - permanently removes record (use with caution)
   */
  async hardDelete(id, companyId, idColumn = 'id') {
    if (!companyId) throw new Error('company_id is required for delete operation');
    
    const result = await db.query(
      `DELETE FROM ${this.tableName}
       WHERE ${idColumn} = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Delete failed: record not found or unauthorized`);
    }
    
    return result.rows[0];
  }

  /**
   * Restore from recycle bin
   */
  async restore(id, companyId, restoredBy, idColumn = 'id') {
    if (!companyId) throw new Error('company_id is required for restore operation');
    
    const result = await db.query(
      `UPDATE ${this.tableName}
       SET deleted_at = NULL, deleted_by = NULL
       WHERE ${idColumn} = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Restore failed: record not found or unauthorized`);
    }
    
    // Remove from recycle bin
    await db.query(
      `DELETE FROM recycle_bin WHERE primary_id = $1`,
      [id]
    );
    
    return result.rows[0];
  }
}

module.exports = BaseDAL;
