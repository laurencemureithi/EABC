/**
 * AUDIT TRAIL ENGINE
 * Immutable append-only logging for compliance and forensics
 * SECURITY CRITICAL - every operation must be logged
 */

const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class AuditEngine {
  /**
   * Log an audit event
   * APPEND ONLY - records are never updated or deleted
   */
  async log(event) {
    // Validate required fields
    if (!event.company_id) throw new Error('company_id is required for audit logging');
    if (!event.action) throw new Error('action is required for audit logging');
    if (!event.entity_type) throw new Error('entity_type is required for audit logging');
    
    const auditId = uuidv4();
    const timestamp = new Date();
    
    try {
      await db.query(
        `INSERT INTO audit_trail 
         (id, timestamp, company_id, user_id, action, entity_type, entity_id, 
          changes, ip_address, user_agent, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          auditId,
          timestamp,
          event.company_id,
          event.user_id || null,
          event.action,
          event.entity_type,
          event.entity_id || null,
          event.changes ? JSON.stringify(event.changes) : null,
          event.ip_address || null,
          event.user_agent || null,
          event.severity || 'info' // info, warning, error, critical
        ]
      );
      
      logger.info('Audit event logged', {
        audit_id: auditId,
        company_id: event.company_id,
        action: event.action,
        entity_type: event.entity_type
      });
      
      return auditId;
    } catch (error) {
      logger.error('Audit logging failed - CRITICAL', {
        event,
        error: error.message
      });
      // Don't throw - allow operation to continue but alert ops
      throw error;
    }
  }

  /**
   * Log user login
   */
  async logLogin(userId, companyId, success, ipAddress, userAgent, reason = null) {
    return this.log({
      company_id: companyId,
      user_id: userId,
      action: success ? 'login_success' : 'login_failed',
      entity_type: 'user_session',
      entity_id: userId,
      changes: { reason },
      ip_address: ipAddress,
      user_agent: userAgent,
      severity: success ? 'info' : 'warning'
    });
  }

  /**
   * Log resource creation
   */
  async logCreate(userId, companyId, entityType, entityId, data, ipAddress, userAgent) {
    return this.log({
      company_id: companyId,
      user_id: userId,
      action: 'create',
      entity_type: entityType,
      entity_id: entityId,
      changes: { created: data },
      ip_address: ipAddress,
      user_agent: userAgent,
      severity: 'info'
    });
  }

  /**
   * Log resource update
   */
  async logUpdate(userId, companyId, entityType, entityId, before, after, ipAddress, userAgent) {
    return this.log({
      company_id: companyId,
      user_id: userId,
      action: 'update',
      entity_type: entityType,
      entity_id: entityId,
      changes: { before, after },
      ip_address: ipAddress,
      user_agent: userAgent,
      severity: 'info'
    });
  }

  /**
   * Log resource deletion
   */
  async logDelete(userId, companyId, entityType, entityId, data, reason = null, ipAddress, userAgent) {
    return this.log({
      company_id: companyId,
      user_id: userId,
      action: 'delete',
      entity_type: entityType,
      entity_id: entityId,
      changes: { deleted: data, reason },
      ip_address: ipAddress,
      user_agent: userAgent,
      severity: 'warning'
    });
  }

  /**
   * Log sensitive operations (permission changes, data exports, etc.)
   */
  async logSensitive(userId, companyId, action, details, ipAddress, userAgent) {
    return this.log({
      company_id: companyId,
      user_id: userId,
      action,
      entity_type: 'sensitive_operation',
      entity_id: null,
      changes: details,
      ip_address: ipAddress,
      user_agent: userAgent,
      severity: 'critical'
    });
  }

  /**
   * Query audit trail for compliance/forensics
   */
  async query(companyId, options = {}) {
    const {
      userId = null,
      action = null,
      entityType = null,
      startDate = null,
      endDate = null,
      limit = 100,
      offset = 0
    } = options;
    
    let query = 'SELECT * FROM audit_trail WHERE company_id = $1';
    const params = [companyId];
    let paramIndex = 2;
    
    if (userId) {
      query += ` AND user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }
    
    if (action) {
      query += ` AND action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }
    
    if (entityType) {
      query += ` AND entity_type = $${paramIndex}`;
      params.push(entityType);
      paramIndex++;
    }
    
    if (startDate) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Export audit trail for compliance reporting
   */
  async export(companyId, startDate, endDate, format = 'json') {
    const records = await this.query(companyId, {
      startDate,
      endDate,
      limit: 10000
    });
    
    if (format === 'csv') {
      return this.convertToCSV(records);
    }
    
    return records;
  }

  /**
   * Convert audit records to CSV
   */
  convertToCSV(records) {
    if (records.length === 0) return '';
    
    const headers = Object.keys(records[0]);
    const csv = [
      headers.join(','),
      ...records.map(record =>
        headers.map(header => {
          let value = record[header];
          if (typeof value === 'object') {
            value = JSON.stringify(value);
          }
          // Escape quotes and wrap in quotes if contains comma
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            value = `"${value.replace(/"/g, '""')}"`;
          }
          return value || '';
        }).join(',')
      )
    ];
    
    return csv.join('\n');
  }
}

module.exports = new AuditEngine();
