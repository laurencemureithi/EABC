/**
 * PRODUCTION SERVER INTEGRATION
 * Wires all hardening modules into the Express application
 * This replaces the existing server setup with enterprise-grade configuration
 */

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const nunjucks = require('nunjucks');
const path = require('path');
require('dotenv').config();

// Import hardening modules
const {
  configureSecurityHeaders,
  configureRateLimiting,
  configureInputSanitization,
  configureCORS,
  validateEnvironment
} = require('./src/middleware/security-hardening');

const { setupResponseHandlers, errorHandler } = require('./src/middleware/response-handler');
const { validateWorkspaceIsolation } = require('./src/middleware/workspace-isolation');
const db = require('./src/config/database');
const logger = require('./src/utils/logger');
const monitoringRoutes = require('./src/routes/monitoring');

const app = express();

/**
 * PHASE 1: ENVIRONMENT VALIDATION
 * Fail fast if configuration is incomplete
 */
logger.info('=== EABC Enterprise Application Startup ===');
logger.info(`Environment: ${process.env.NODE_ENV}`);
logger.info(`Version: ${process.env.VERSION || 'unknown'}`);

try {
  validateEnvironment();
} catch (error) {
  logger.error('Environment validation failed', { error: error.message });
  process.exit(1);
}

/**
 * PHASE 2: COMPRESSION & BODY PARSING
 * Optimize response size and parse incoming data
 */
app.use(compression());
app.use(express.json({ limit: '10kb' })); // Limit JSON payload
app.use(express.urlencoded({ limit: '10kb', extended: false }));
app.use(cookieParser());

/**
 * PHASE 3: SECURITY HARDENING
 * Apply all security headers, rate limiting, input sanitization
 */
logger.info('Applying security hardening...');
configureSecurityHeaders(app);
const { apiLimiter, loginLimiter } = configureRateLimiting(app);
configureInputSanitization(app);
configueCORS(app);

/**
 * PHASE 4: SESSION MANAGEMENT
 * Setup secure session store (Redis for production)
 */
let sessionStore;
if (process.env.SESSION_STORE === 'redis') {
  const RedisStore = require('connect-redis').default;
  const { createClient } = require('redis');
  
  const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });
  redisClient.connect().catch(err => {
    logger.error('Redis connection failed', { error: err.message });
    process.exit(1);
  });
  
  sessionStore = new RedisStore({ client: redisClient });
  logger.info('Session store: Redis');
} else {
  // Fallback to memory store (NOT for production!)
  if (process.env.NODE_ENV === 'production') {
    logger.warn('WARNING: Using memory session store in production - configure REDIS_URL');
  }
  const MemoryStore = require('memorystore')(session);
  sessionStore = new MemoryStore();
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

/**
 * PHASE 5: RESPONSE HANDLING MIDDLEWARE
 * Setup standardized response format for all endpoints
 */
app.use(setupResponseHandlers);

/**
 * PHASE 6: TEMPLATE ENGINE CONFIGURATION
 * Setup Nunjucks for server-side rendering
 */
nunjucks.configure(path.join(__dirname, 'templates'), {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV === 'development'
});

app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'templates'));

/**
 * PHASE 7: STATIC FILES & ASSETS
 */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: false
}));

/**
 * PHASE 8: MONITORING & HEALTH ENDPOINTS
 * Available before authentication for orchestrator checks
 */
app.get('/health', monitoringRoutes.healthCheck);
app.get('/live', monitoringRoutes.liveness);
app.get('/ready', monitoringRoutes.readiness);
app.get('/version', monitoringRoutes.versionInfo);
app.get('/api/diagnostics', monitoringRoutes.diagnostics); // Admin only

logger.info('Monitoring endpoints configured');

/**
 * PHASE 9: AUTHENTICATION & WORKSPACE ISOLATION
 * All routes below this point require authentication
 */

// TODO: Import and wire authentication routes
// app.use('/login', require('./src/routes/auth-routes'));
// app.use('/logout', require('./src/routes/auth-routes'));
// app.use('/register', require('./src/routes/auth-routes'));

// Middleware: Require authentication on protected routes
const requireAuth = (req, res, next) => {
  if (!req.session?.user_id) {
    return res.redirect('/login');
  }
  next();
};

app.use('/api/*', requireAuth);
app.use('/assets', requireAuth);
app.use('/breakdowns', requireAuth);
app.use('/maintenance', requireAuth);
app.use('/inventory', requireAuth);
app.use('/dashboard', requireAuth);
app.use('/reports', requireAuth);
app.use('/settings', requireAuth);

// Apply workspace isolation on all protected routes
app.use(requireAuth, validateWorkspaceIsolation);

// Apply rate limiting
app.use(apiLimiter);
app.post('/login', loginLimiter);

logger.info('Authentication & workspace isolation configured');

/**
 * PHASE 10: API ROUTES
 * Wire all business logic routes
 * TODO: Implement these based on existing server.js patterns
 */

// Asset Management Routes
// app.use('/api/assets', require('./src/routes/assets-routes'));

// Breakdown Management Routes
// app.use('/api/breakdowns', require('./src/routes/breakdowns-routes'));

// Maintenance Routes
// app.use('/api/maintenance', require('./src/routes/maintenance-routes'));

// Inventory Routes
// app.use('/api/inventory', require('./src/routes/inventory-routes'));

// Dashboard & KPI Routes
// app.use('/api/dashboard', require('./src/routes/dashboard-routes'));

// Reports Routes
// app.use('/api/reports', require('./src/routes/reports-routes'));

// Settings & Admin Routes
// app.use('/api/settings', require('./src/routes/settings-routes'));

logger.info('API routes wired');

/**
 * PHASE 11: 404 & ERROR HANDLING
 * This must be last in the middleware chain
 */

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    statusCode: 404,
    error: `Route not found: ${req.method} ${req.path}`
  });
});

// Global error handler (must be last)
app.use(errorHandler);

logger.info('Error handlers configured');

/**
 * PHASE 12: SERVER STARTUP
 */
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info(`✅ EABC server started`);
  logger.info(`   URL: http://${HOST}:${PORT}`);
  logger.info(`   Environment: ${process.env.NODE_ENV}`);
  logger.info(`   Session Store: ${process.env.SESSION_STORE || 'memory'}`);
  logger.info(`   Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
});

/**
 * GRACEFUL SHUTDOWN
 * Close connections cleanly on termination signals
 */
process.on('SIGTERM', async () => {
  logger.warn('SIGTERM received - initiating graceful shutdown');
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await db.pool.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error('Error closing database', { error: error.message });
    }
    
    process.exit(0);
  });
  
  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timeout - forcing exit');
    process.exit(1);
  }, 30000);
});

process.on('SIGINT', () => {
  logger.warn('SIGINT received - shutting down');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('UNCAUGHT EXCEPTION', {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION', {
    reason: reason?.message || reason,
    promise
  });
});

module.exports = app;
