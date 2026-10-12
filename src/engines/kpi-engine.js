/**
 * KPI CALCULATION ENGINE
 * Calculates real-time operational KPIs from PostgreSQL data
 * MTTR, MTBF, OEE, PM Compliance, Maintenance Spend
 */

const db = require('../config/database');
const logger = require('../utils/logger');

class KPIEngine {
  /**
   * Calculate Mean Time To Repair (MTTR) in hours
   * Average time from breakdown creation to resolution
   */
  async calculateMTTR(companyId, assetId = null, daysBack = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    let query = `
      SELECT 
        COUNT(*) as total_incidents,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 2) as mttr_hours
      FROM breakdowns
      WHERE company_id = $1 
        AND status = 'resolved'
        AND resolved_at IS NOT NULL
        AND created_at >= $2
        AND deleted_at IS NULL
    `;
    
    const params = [companyId, cutoffDate];
    
    if (assetId) {
      query += ` AND asset_id = $3`;
      params.push(assetId);
    }
    
    const result = await db.query(query, params);
    const row = result.rows[0];
    
    return {
      mttr_hours: row.mttr_hours ? parseFloat(row.mttr_hours) : 0,
      incidents_resolved: parseInt(row.total_incidents, 10),
      period_days: daysBack
    };
  }

  /**
   * Calculate Mean Time Between Failures (MTBF) in hours
   * Average uptime between consecutive breakdowns
   */
  async calculateMTBF(companyId, assetId = null, daysBack = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    // Get all resolved breakdowns sorted by date
    let query = `
      SELECT created_at, resolved_at 
      FROM breakdowns
      WHERE company_id = $1
        AND status = 'resolved'
        AND created_at >= $2
        AND deleted_at IS NULL
    `;
    
    const params = [companyId, cutoffDate];
    
    if (assetId) {
      query += ` AND asset_id = $3`;
      params.push(assetId);
    }
    
    query += ` ORDER BY created_at ASC`;
    
    const result = await db.query(query, params);
    const breakdowns = result.rows;
    
    if (breakdowns.length < 2) {
      return {
        mtbf_hours: daysBack * 24, // Assume full operational period
        incidents_total: breakdowns.length,
        period_days: daysBack
      };
    }
    
    // Calculate time gaps between resolutions and next failures
    let totalUptime = 0;
    for (let i = 0; i < breakdowns.length - 1; i++) {
      const downtimeEnd = new Date(breakdowns[i].resolved_at);
      const nextFailure = new Date(breakdowns[i + 1].created_at);
      const uptimeHours = (nextFailure - downtimeEnd) / (1000 * 60 * 60);
      totalUptime += uptimeHours;
    }
    
    const mtbf = totalUptime / (breakdowns.length - 1);
    
    return {
      mtbf_hours: parseFloat(mtbf.toFixed(2)),
      incidents_total: breakdowns.length,
      period_days: daysBack
    };
  }

  /**
   * Calculate Preventive Maintenance (PM) Compliance %
   * Percentage of scheduled PM tasks completed on time
   */
  async calculatePMCompliance(companyId, assetId = null, daysBack = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    let query = `
      SELECT 
        COUNT(*) as total_scheduled,
        COUNT(CASE WHEN status = 'completed' AND completed_date <= scheduled_date THEN 1 END) as completed_ontime,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_total,
        COUNT(CASE WHEN status IN ('scheduled', 'overdue') THEN 1 END) as pending
      FROM maintenance_tasks
      WHERE company_id = $1
        AND maintenance_type = 'PM'
        AND scheduled_date >= $2
        AND deleted_at IS NULL
    `;
    
    const params = [companyId, cutoffDate];
    
    if (assetId) {
      query += ` AND asset_id = $3`;
      params.push(assetId);
    }
    
    const result = await db.query(query, params);
    const row = result.rows[0];
    
    const total = parseInt(row.total_scheduled, 10);
    const completed = parseInt(row.completed_ontime, 10);
    const compliance = total > 0 ? parseFloat(((completed / total) * 100).toFixed(2)) : 100;
    
    return {
      compliance_percent: compliance,
      completed_ontime: completed,
      completed_total: parseInt(row.completed_total, 10),
      pending: parseInt(row.pending, 10),
      total_scheduled: total,
      period_days: daysBack
    };
  }

  /**
   * Calculate Overall Equipment Effectiveness (OEE)
   * Availability × Performance × Quality
   */
  async calculateOEE(companyId, assetId = null, daysBack = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    // Availability = (Planned Time - Downtime) / Planned Time
    const downtimeResult = await db.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 0) as total_downtime_hours
       FROM breakdowns
       WHERE company_id = $1
         AND status = 'resolved'
         AND created_at >= $2
         AND deleted_at IS NULL
       ${assetId ? 'AND asset_id = $3' : ''}`,
      assetId ? [companyId, cutoffDate, assetId] : [companyId, cutoffDate]
    );
    
    const totalDowntimeHours = parseFloat(downtimeResult.rows[0].total_downtime_hours) || 0;
    const plannedHours = daysBack * 24;
    const availability = Math.max(0, ((plannedHours - totalDowntimeHours) / plannedHours) * 100);
    
    // Performance = Planned Output / Actual Output (requires production data)
    // For now, assume 100% if no degradation
    let performance = 100;
    if (assetId) {
      const statusResult = await db.query(
        'SELECT status FROM assets WHERE id = $1 AND company_id = $2',
        [assetId, companyId]
      );
      if (statusResult.rows[0]?.status === 'degraded') {
        performance = 80; // Reduce performance if degraded
      }
    }
    
    // Quality = Good Units / Total Units (requires production data)
    const quality = 100; // Default to 100% if no quality issues logged
    
    const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;
    
    return {
      oee_percent: parseFloat(oee.toFixed(2)),
      availability_percent: parseFloat(availability.toFixed(2)),
      performance_percent: performance,
      quality_percent: quality,
      downtime_hours: totalDowntimeHours,
      period_days: daysBack
    };
  }

  /**
   * Calculate total maintenance spend (MTD or custom period)
   */
  async calculateMaintenanceSpend(companyId, assetId = null, startDate = null, endDate = null) {
    if (!startDate) {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }
    if (!endDate) {
      endDate = new Date();
    }
    
    let query = `
      SELECT 
        COALESCE(SUM(cost), 0) as total_pm_cost,
        COUNT(*) as total_pm_tasks
      FROM maintenance_tasks
      WHERE company_id = $1
        AND maintenance_type = 'PM'
        AND status = 'completed'
        AND completed_date BETWEEN $2 AND $3
        AND deleted_at IS NULL
    `;
    
    const params = [companyId, startDate, endDate];
    
    if (assetId) {
      query += ` AND asset_id = $4`;
      params.push(assetId);
    }
    
    const pmResult = await db.query(query, params);
    const pmCost = parseFloat(pmResult.rows[0].total_pm_cost) || 0;
    const pmTasks = parseInt(pmResult.rows[0].total_pm_tasks, 10);
    
    // Breakdown repair costs
    query = `
      SELECT 
        COALESCE(SUM(repair_labor_cost), 0) as total_repair_labor,
        COUNT(*) as total_breakdowns
      FROM breakdowns
      WHERE company_id = $1
        AND status = 'resolved'
        AND resolved_at BETWEEN $2 AND $3
        AND deleted_at IS NULL
    `;
    
    const params2 = [companyId, startDate, endDate];
    
    if (assetId) {
      query += ` AND asset_id = $4`;
      params2.push(assetId);
    }
    
    const bdResult = await db.query(query, params2);
    const repairCost = parseFloat(bdResult.rows[0].total_repair_labor) || 0;
    const breakdowns = parseInt(bdResult.rows[0].total_breakdowns, 10);
    
    // Spare parts cost
    const partsResult = await db.query(
      `SELECT COALESCE(SUM(qty * unit_price), 0) as total_parts_cost
       FROM inventory_consumption
       WHERE company_id = $1
         AND date BETWEEN $2 AND $3
         AND deleted_at IS NULL
       ${assetId ? 'AND asset_id = $4' : ''}`,
      assetId ? [companyId, startDate, endDate, assetId] : [companyId, startDate, endDate]
    );
    
    const partsCost = parseFloat(partsResult.rows[0].total_parts_cost) || 0;
    
    const totalCost = pmCost + repairCost + partsCost;
    
    return {
      total_spend: parseFloat(totalCost.toFixed(2)),
      pm_spend: parseFloat(pmCost.toFixed(2)),
      pm_tasks: pmTasks,
      breakdown_repair_spend: parseFloat(repairCost.toFixed(2)),
      breakdowns_repaired: breakdowns,
      spare_parts_spend: parseFloat(partsCost.toFixed(2)),
      period_start: startDate,
      period_end: endDate
    };
  }

  /**
   * Generate comprehensive dashboard KPIs
   */
  async generateDashboardKPIs(companyId) {
    try {
      const [mttr, mtbf, pmCompliance, oee, spend] = await Promise.all([
        this.calculateMTTR(companyId),
        this.calculateMTBF(companyId),
        this.calculatePMCompliance(companyId),
        this.calculateOEE(companyId),
        this.calculateMaintenanceSpend(companyId)
      ]);
      
      return {
        generated_at: new Date().toISOString(),
        company_id: companyId,
        mttr,
        mtbf,
        pm_compliance: pmCompliance,
        oee,
        maintenance_spend: spend
      };
    } catch (error) {
      logger.error('KPI calculation failed', { companyId, error: error.message });
      throw error;
    }
  }
}

module.exports = new KPIEngine();
