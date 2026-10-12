/**
 * src/app.js
 * Express app factory shared by long-running server and Vercel serverless function.
 */

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');
const nunjucks = require('nunjucks');
const { pool } = require('./db/pool');
const responseWrapper = require('./middleware/response-wrapper');
const workspaceIsolation = require('./middleware/workspace-isolation');
const auditEngine = require('./audit/audit-engine');
const dal = require('./db/dal');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

function createApp() {
  const app = express();

  // Nunjucks (if templates exist)
  const viewsDir = path.join(process.cwd(), 'templates');
  if (fs.existsSync(viewsDir)) {
    nunjucks.configure(viewsDir, {
      autoescape: true,
      express: app,
      watch: process.env.NODE_ENV !== 'production',
    });
  }

  // Basic middleware
  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Rate limiter
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 200,
  }));

  // Session store via Postgres (connect-pg-simple)
  const sessionConfig = {
    store: new PgSession({
      pool,                // Connection pool
      tableName: 'session' // Table to use
    }),
    secret: process.env.SESSION_SECRET || 'change_this_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    }
  };
  app.use(session(sessionConfig));

  // Response wrapper
  app.use(responseWrapper);

  // Health endpoint
  app.get('/health', async (req, res) => {
    try {
      const dbStatus = await pool.query('SELECT 1 AS ok');
      res.success({
        status: 'healthy',
        database: dbStatus && dbStatus.rowCount === 1 ? 'connected' : 'disconnected',
        pid: process.pid,
      });
    } catch (err) {
      res.error('unhealthy', 500, { error: err.message });
    }
  });

  // Dev helper: quick "login" to set session company_id (only for dev)
  app.get('/dev-login', async (req, res) => {
    // Danger: Only for local dev/testing. Not for prod.
    if (process.env.NODE_ENV === 'production') {
      return res.error('Not allowed in production', 403);
    }
    // pick first company
    try {
      const r = await pool.query('SELECT id, code, name FROM companies LIMIT 1');
      if (r.rowCount === 0) return res.error('No company present. Run migrations.', 500);
      const c = r.rows[0];
      req.session.company_id = c.id;
      req.session.company_code = c.code;
      await auditEngine.log({
        company_id: c.id,
        user_id: null,
        action: 'dev_login',
        entity_type: 'session',
        entity_id: req.sessionID,
        changes: { info: 'dev-login set company_id' },
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
      });
      res.success({ message: 'dev-login complete', company: c });
    } catch (err) {
      res.error('dev-login failed', 500, err.message);
    }
  });

  // Basic file upload (dev: local disk)
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const upload = multer({ dest: uploadsDir });

  // --- API routes ---
  const api = express.Router();

  // Mount workspace isolation middleware on routes that require a company context
  api.use(['/assets', '/breakdowns', '/maintenance', '/inventory'], workspaceIsolation);

  // Assets endpoints
  api.get('/assets', async (req, res) => {
    try {
      const companyId = req.session.company_id;
      const assets = await dal.getAssets(companyId);
      res.success({ assets });
    } catch (err) {
      res.error('Failed to fetch assets', 500, err.message);
    }
  });

  api.post('/assets', async (req, res) => {
    try {
      const companyId = req.session.company_id;
      const payload = req.body;
      if (!payload.asset_id || !payload.asset_name) {
        return res.error('asset_id and asset_name are required', 400);
      }
      const newAsset = await dal.createAsset(companyId, payload);
      await auditEngine.log({
        company_id: companyId,
        user_id: req.session.user_id || null,
        action: 'create',
        entity_type: 'asset',
        entity_id: newAsset.id,
        changes: { after: newAsset },
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
      });
      res.success({ asset: newAsset }, 201);
    } catch (err) {
      res.error('Failed to create asset', 500, err.message);
    }
  });

  // Simple breakdown creation
  api.post('/breakdowns', async (req, res) => {
    try {
      const companyId = req.session.company_id;
      const payload = req.body;
      if (!payload.asset_id || !payload.incident_title) {
        return res.error('asset_id and incident_title are required', 400);
      }
      const breakdown = await dal.createBreakdown(companyId, payload);
      await auditEngine.log({
        company_id: companyId,
        user_id: req.session.user_id || null,
        action: 'create',
        entity_type: 'breakdown',
        entity_id: breakdown.id,
        changes: { after: breakdown },
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
      });
      res.success({ breakdown }, 201);
    } catch (err) {
      res.error('Failed to create breakdown', 500, err.message);
    }
  });

  // Uploads (dev)
  api.post('/uploads', upload.single('file'), (req, res) => {
    if (!req.file) return res.error('No file uploaded', 400);
    // Return simple metadata (in prod you'd upload to S3)
    res.success({ filename: req.file.filename, originalname: req.file.originalname });
  });

  app.use('/api', api);

  // Static assets + UI fallback (if templates/static exist)
  if (fs.existsSync(path.join(process.cwd(), 'static'))) {
    app.use('/static', express.static(path.join(process.cwd(), 'static')));
  }

  // Root - simple info
  app.get('/', (req, res) => {
    if (app.render) {
      // If templates available, render index
      if (fs.existsSync(viewsDir)) return res.render('index.njk', { session: req.session });
    }
    res.send(`<h2>EABC - Opsloom</h2><p>Visit <a href="/api/assets">/api/assets</a> or /health</p>`);
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'not_found', path: req.originalUrl });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  });

  return app;
}

module.exports = { createApp };
