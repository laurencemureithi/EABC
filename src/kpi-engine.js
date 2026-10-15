/**
 * Dedicated KPI Engine for EABC (Opsloom)
 * Authoritative, multi-tenant calculation engine for reliability and operational metrics.
 */

function calculateDowntimeHours(b) {
  if (!b) return 0.0;
  if (b.downtime_hours !== undefined && b.downtime_hours !== null && !isNaN(Number(b.downtime_hours))) {
    return Math.round(Number(b.downtime_hours) * 10) / 10;
  }
  if (b.duration_mins !== undefined && b.duration_mins !== null && !isNaN(Number(b.duration_mins))) {
    return Math.round((Number(b.duration_mins) / 60) * 10) / 10;
  }
  const reported = new Date(b.reported_dt || b.created_at);
  if (!isNaN(reported.getTime())) {
    const end = (b.status === 'resolved' || b.status === 'closed') && b.resolved_at
      ? new Date(b.resolved_at)
      : new Date();
    const diffHours = (end - reported) / (1000 * 60 * 60);
    return Math.max(0.0, Math.round(diffHours * 10) / 10);
  }
  return 0.0;
}

function calculateFleetUptime(assets = []) {
  if (!Array.isArray(assets) || assets.length === 0) return 0.0;
  const operational = assets.filter(a => a && a.status === 'operational').length;
  return Math.round((operational / assets.length) * 1000) / 10;
}

function calculateMTTR(breakdowns = []) {
  if (!Array.isArray(breakdowns) || breakdowns.length === 0) return 0.0;
  const totalDowntime = breakdowns.reduce((sum, b) => sum + calculateDowntimeHours(b), 0);
  return Math.round((totalDowntime / breakdowns.length) * 10) / 10;
}

function calculateMTBF(assets = [], breakdowns = [], periodOperatingHours = 720) {
  if (!Array.isArray(assets) || assets.length === 0 || !Array.isArray(breakdowns) || breakdowns.length === 0) {
    return 0.0;
  }
  const operationalAssets = assets.filter(a => a && a.status === 'operational').length;
  if (operationalAssets === 0) return 0.0;
  const totalDowntime = breakdowns.reduce((sum, b) => sum + calculateDowntimeHours(b), 0);
  const totalOperatingHours = Math.max(0, (operationalAssets * periodOperatingHours) - totalDowntime);
  return Math.round((totalOperatingHours / breakdowns.length) * 10) / 10;
}

function calculatePMCompliance(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0.0;
  const completed = tasks.filter(t => t && t.status === 'completed').length;
  const upcoming = tasks.filter(t => t && t.status === 'upcoming').length;
  return Math.round(((completed + upcoming) / tasks.length) * 1000) / 10;
}

function calculateMaintenanceSpend(tasks = [], breakdowns = []) {
  const taskSpend = (Array.isArray(tasks) ? tasks : []).reduce(
    (sum, t) => sum + Number(t.cost_total || t.cost || 0),
    0
  );
  const bdSpend = (Array.isArray(breakdowns) ? breakdowns : []).reduce(
    (sum, b) => sum + Number(b.cost_total || b.cost || 0),
    0
  );
  return taskSpend + bdSpend;
}

function calculateOEE(assets = [], breakdowns = [], targets = {}) {
  if (!Array.isArray(assets) || assets.length === 0) return 0.0;
  const operational = assets.filter(a => a && a.status === 'operational').length;
  const availability = assets.length > 0 ? (operational / assets.length) : 0.0;
  const targetOee = Number(targets.oee_benchmark_pct) || 85.0;
  const performanceFactor = Math.min(1.0, targetOee / 100);
  const qualityFactor = 0.98; // High speed production quality standard
  const oee = availability * performanceFactor * qualityFactor * 100;
  return Math.round(oee * 10) / 10;
}

module.exports = {
  calculateDowntimeHours,
  calculateFleetUptime,
  calculateMTTR,
  calculateMTBF,
  calculatePMCompliance,
  calculateMaintenanceSpend,
  calculateOEE
};
