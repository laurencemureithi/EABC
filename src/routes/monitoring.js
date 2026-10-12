/**
 * HEALTH CHECK & MONITORING ENDPOINTS
 * Production readiness probes and system diagnostics
 */

const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Health check endpoint for orchestrators (K8s, Docker Compose, etc.)
 */
async function healthCheck(req, res) {
  try {
    const dbHealth = await db.healthCheck();
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    const health = {
      status: dbHealth.status === 'connected' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(uptime),
      checks: {
        database: {
          status: dbHealth.status,
          response_time: dbHealth.timestamp
        },
        memory: {
          status: memory.heapUsed / memory.heapTotal < 0.9 ? 'healthy' : 'warning',
          heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
          external_mb: Math.round(memory.external / 1024 / 1024)
        }
      }
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    return res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
}

/**
 * Liveness probe (is the app running?)
 */
async function liveness(req, res) {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
}

/**
 * Readiness probe (is the app ready to accept traffic?)
 */
async function readiness(req, res) {
  try {
    const dbHealth = await db.healthCheck();
    
    if (dbHealth.status !== 'connected') {
      return res.status(503).json({
        ready: false,
        reason: 'Database not connected'
      });
    }

    res.status(200).json({
      ready: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error.message
    });
  }
}

/**
 * Diagnostic information endpoint (admin only)
 */
async function diagnostics(req, res) {
  try {
    // Verify admin access
    if (req.session?.role !== 'administrator') {
      logger.warn('Unauthorized diagnostics access attempt', {
        ip: req.ip,
        userId: req.session?.user_id
      });
      return res.status(403).json({
        ok: false,
        error: 'Unauthorized - administrator access required'
      });
    }

    const memory = process.memoryUsage();
    const dbHealth = await db.healthCheck();

    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      version: process.env.VERSION || 'unknown',
      uptime: process.uptime(),
      memory: {
        rss_mb: Math.round(memory.rss / 1024 / 1024),
        heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
        external_mb: Math.round(memory.external / 1024 / 1024)
      },
      database: {
        status: dbHealth.status,
        connected: dbHealth.status === 'connected'
      },
      process: {
        pid: process.pid,
        node_version: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };

    res.status(200).json(diagnostics);
  } catch (error) {
    logger.error('Diagnostics endpoint failed', { error: error.message });
    res.status(500).json({
      ok: false,
      error: 'Failed to generate diagnostics'
    });
  }
}

/**
 * Version information endpoint
 */
function versionInfo(req, res) {
  res.status(200).json({
    name: 'EABC (Opsloom)',
    version: process.env.VERSION || 'unknown',
    environment: process.env.NODE_ENV,
    build_number: process.env.BUILD_NUMBER || 'unknown',
    git_commit: process.env.GIT_COMMIT_SHA || 'unknown',
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  healthCheck,
  liveness,
  readiness,
  diagnostics,
  versionInfo
};
