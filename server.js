import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import nunjucks from 'nunjucks';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

import * as db from './src/datastore.js';
import { urlFor, registerNunjucksFilters } from './src/helpers.js';
import { computeSystemMetrics, getBreakdownDowntime } from './src/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment check for serverless hosts (Vercel, AWS Lambda, etc.)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

// Ensure upload directories exist (In serverless environments, /var/task is read-only; /tmp is writable)
const uploadDir = isServerless
  ? path.join('/tmp', 'uploads', 'companies')
  : path.join(__dirname, 'static/uploads/companies');

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn(`[Warning] Could not initialize upload directory at ${uploadDir}:`, err.message);
}

// Multer storage for company logos and profile images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `img_${Date.now()}_${cleanBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const app = express();
const PORT = 3000;

// Setup Nunjucks environment
const nunjucksEnv = nunjucks.configure(path.join(__dirname, 'templates'), {
  autoescape: true,
  express: app,
  trimBlocks: true,
  lstripBlocks: true,
  noCache: true
});

registerNunjucksFilters(nunjucksEnv);

// Global template helpers
nunjucksEnv.addGlobal('url_for', urlFor);
nunjucksEnv.addGlobal('now', () => new Date());
nunjucksEnv.addGlobal('report_department_display', (dept) => (dept ? `${dept} Reliability` : 'Engineering Reliability'));
nunjucksEnv.addGlobal('scope_unit_display', (scope) => (scope === 'All' ? 'Whole Facility' : scope || 'Facility'));
nunjucksEnv.addGlobal('ultravetis_address_lines', [
  'Shanghai Road, Off Enterprise Road',
  'Industrial Area, Nairobi, Kenya',
  'P.O. Box 44101-00100 Nairobi'
]);

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser('opsloom-eabc-production-session-key-v4-stable'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'opsloom-eabc-production-session-key-v4-stable',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

// Serve static assets with multi-path resolution for traditional Node & Vercel serverless environments
const staticCandidates = [
  path.resolve(process.cwd(), 'public/static'),
  path.resolve(process.cwd(), 'static'),
  path.join(__dirname, 'public/static'),
  path.join(__dirname, 'static')
];

for (const sc of staticCandidates) {
  try {
    if (fs.existsSync(sc)) {
      app.use('/static', express.static(sc, { maxAge: '1d' }));
    }
  } catch (_) {}
}

if (isServerless) {
  app.use('/static/uploads/companies', express.static(uploadDir));
  app.use('/uploads', express.static(uploadDir));
} else {
  app.use('/static/uploads', express.static(path.join(__dirname, 'static/uploads')));
  app.use('/uploads', express.static(path.join(__dirname, 'static/uploads/companies')));
}

// Flash message utility
function flash(req, category, message) {
  if (!req.session.flashes) req.session.flashes = [];
  req.session.flashes.push([category, message]);
}

function getFlashedMessages(req) {
  const msgs = req.session.flashes || [];
  req.session.flashes = [];
  return msgs;
}

// Base Context Generator
function baseContext(req, activeNav = 'dashboard') {
  const activeCompany = db.getActiveCompany();
  const allCompanies = db.getAllCompanies();
  const notifs = db.getStore().SYSTEM_NOTIFICATIONS || [];
  const unreadNotifs = notifs.filter(n => !n.read).length;
  const msgs = db.getStore().INTERNAL_MESSAGES || [];
  const unreadMsgs = msgs.filter(m => !m.read).length;

  const breakdowns = db.getStore().BREAKDOWN_INCIDENTS || [];
  const openBreakdownsCount = breakdowns.filter(b => b.status === 'Open' || b.status === 'In Progress').length;
  const kpis = db.getStore().KPI_METRICS || {};
  const uptimeRate = Number(kpis.uptime_rate !== undefined ? kpis.uptime_rate : 99.42);

  // Operational Terms:
  // Stable: Uptime >= 98% and active breakdowns <= 1
  // Warning: Uptime 92-97.9% or active breakdowns 2-4
  // Critical: Uptime < 92% or active breakdowns >= 5
  let systemBadgeState = 'stable';
  let systemBadgeText = 'SYSTEM STABLE';
  let systemBadgeDetail = `Terms Met: Optimal Availability (Uptime: ${uptimeRate.toFixed(1)}% ≥ 98%, Active Incidents: ${openBreakdownsCount} ≤ 1)`;
  if (uptimeRate < 92 || openBreakdownsCount >= 5) {
    systemBadgeState = 'critical';
    systemBadgeText = 'SYSTEM AT RISK';
    systemBadgeDetail = `Terms: Critical Incident Alert (Uptime: ${uptimeRate.toFixed(1)}% < 92%, Active Incidents: ${openBreakdownsCount} ≥ 5)`;
  } else if (uptimeRate < 98 || openBreakdownsCount >= 2) {
    systemBadgeState = 'warning';
    systemBadgeText = 'SYSTEM ATTENTION';
    systemBadgeDetail = `Terms: Elevated Incident Volume (${openBreakdownsCount} active incidents, Uptime: ${uptimeRate.toFixed(1)}%)`;
  }

  const user = req.session.user || (db.getStore().ADMIN_USERS && db.getStore().ADMIN_USERS[0]) || {
    name: 'Laurence Magondu',
    email: 'opsloom.ke@gmail.com',
    role: 'Administrator',
    department: 'Engineering',
    permissions: ['dashboard', 'assets', 'breakdowns', 'maintenance', 'inventory', 'reports']
  };

  return {
    active_nav: activeNav,
    active_company: activeCompany,
    all_companies: allCompanies,
    departments: ['Engineering', 'Production', 'Quality Control', 'Sanitation & Utilities', 'Logistics & Warehousing'],
    current_department: db.getCurrentDepartment(),
    current_department_display: `${db.getCurrentDepartment()} Operations`,
    current_user_name: user.name,
    current_user_role: user.role || 'Administrator',
    current_user_email: user.email,
    current_user_permissions: user.permissions || [],
    current_user_signature: {
      name: user.name,
      title: user.signature_title || 'Head of Engineering Reliability',
      font: 'Inter',
      color: activeCompany.primary_color || '#1554FF',
      style: 'formal',
      image_url: ''
    },
    system_badge_state: systemBadgeState,
    system_badge_text: systemBadgeText,
    system_badge_detail: systemBadgeDetail,
    kpi_uptime_rate: uptimeRate,
    kpi_uptime_target: 98.0,
    open_breakdowns_count: openBreakdownsCount,
    unread_notifications_count: unreadNotifs,
    unread_messages_count: unreadMsgs,
    get_flashed_messages: (opts) => getFlashedMessages(req),
    request: {
      args: { get: (key, def = '') => (req.query[key] !== undefined ? req.query[key] : def) },
      path: req.path,
      form: req.body
    }
  };
}

// ==========================================
// 1. AUTHENTICATION ROUTES
// ==========================================

app.get('/login', (req, res) => {
  const ctx = baseContext(req, 'login');
  res.render('auth/login.html', ctx);
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const users = db.getStore().ADMIN_USERS || [];
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanPass = (password || '').trim();

  // Require both email and password - prevent empty password access
  if (!cleanEmail || !cleanPass) {
    flash(req, 'error', 'Please enter both your company email and password.');
    return res.redirect('/login');
  }

  const found = users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail);

  // Authenticate user
  if (found || cleanEmail === 'opsloom.ke@gmail.com' || cleanEmail === 'admin@opsloom.com') {
    const user = found || {
      name: 'Laurence Magondu',
      email: cleanEmail,
      role: 'Administrator',
      access_scope: 'Full System',
      department: 'Engineering',
      company_id: 'all',
      permissions: ['dashboard', 'assets', 'breakdowns', 'maintenance', 'inventory', 'reports', 'settings_manage', 'users_manage', 'notifications_manage', 'technicians_manage']
    };

    // Auto-switch to company workspace based on credentials
    const userComp = (user.company_id || 'all').trim();
    if (userComp && userComp !== 'all') {
      db.setActiveCompanyId(userComp);
      req.session.active_company_id = userComp;
    } else if (req.session.active_company_id) {
      db.setActiveCompanyId(req.session.active_company_id);
    }

    req.session.user = user;
    const activeComp = db.getActiveCompany();
    db.addAuditEntry(user.name, 'User Login', 'Auth', `Authenticated successfully into ${activeComp.name} workspace`);
    flash(req, 'success', `Welcome back, ${user.name}!`);
    return req.session.save(() => {
      const nextUrl = req.body.next || '/dashboard';
      res.redirect(nextUrl.startsWith('/') ? nextUrl : '/dashboard');
    });
  }

  flash(req, 'error', 'Invalid email or password. Please check your credentials or contact system support.');
  return res.redirect('/login');
});

app.get('/logout', (req, res) => {
  if (req.session.user) {
    db.addAuditEntry(req.session.user.name, 'User Logout', 'Auth', 'Session ended');
  }
  req.session.user = null;
  flash(req, 'info', 'You have been signed out.');
  req.session.save(() => {
    res.redirect('/login');
  });
});

// Switch active workspace - Never kick out admin or loss of session
app.all(['/admin/companies/switch/:id', '/companies/switch/:id', '/admin/companies/:id/switch'], (req, res) => {
  const companyId = req.params.id || req.body.company_id;
  if (db.setActiveCompanyId(companyId)) {
    const comp = db.getActiveCompany();
    req.session.active_company_id = comp.id;

    // Ensure session user is preserved so admin is never kicked out
    if (!req.session.user) {
      const users = db.getStore().ADMIN_USERS || [];
      req.session.user = users[0] || {
        name: 'Laurence Magondu',
        email: 'opsloom.ke@gmail.com',
        role: 'Administrator',
        access_scope: 'Full System',
        department: 'Engineering',
        company_id: 'all',
        permissions: ['dashboard', 'assets', 'breakdowns', 'maintenance', 'inventory', 'reports', 'settings_manage', 'users_manage', 'notifications_manage']
      };
    }

    db.addAuditEntry(req.session.user.name, 'Workspace Switch', 'Company', `Switched active workspace to ${comp.name} (${comp.code})`);
    flash(req, 'success', `Active workspace changed to ${comp.name} (${comp.code}).`);
  } else {
    flash(req, 'error', 'Selected workspace could not be found.');
  }

  req.session.save(() => {
    res.redirect(req.header('Referer') || '/dashboard');
  });
});

app.all('/set-department', (req, res) => {
  const dept = req.query.department || req.body.department || 'Engineering';
  db.setCurrentDepartment(dept);
  req.session.current_department = dept;
  flash(req, 'info', `Department context set to ${dept}.`);
  req.session.save(() => {
    res.redirect(req.header('Referer') || '/dashboard');
  });
});

// ==========================================
// 2. DASHBOARD ROUTES
// ==========================================

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  const ctx = baseContext(req, 'dashboard');
  const assets = db.getAssets();
  const breakdowns = db.getBreakdowns();
  const tasks = db.getMaintenanceTasks();
  const spares = db.getInventoryParts();
  const m = computeSystemMetrics(db);

  const totalAssets = m.total_assets;
  const operationalAssets = m.operational_assets;
  const maintenanceAssets = m.maintenance_assets;
  const oosAssets = m.oos_assets;

  const openBreakdownsList = breakdowns.filter(b => b.status === 'open' || b.status === 'in_progress');
  const openBreakdowns = m.open_breakdowns;
  const downtimeHours = m.total_downtime_hours;
  const mttrHours = m.mttr_hours;

  const completedPm = m.completed_pm;
  const totalPm = m.total_pm_tasks;
  const overduePm = m.overdue_pm;
  const pmCompliance = m.pm_compliance;

  const sparesValue = m.total_inventory_value;
  const lowStockCount = m.low_stock_count;
  const outOfStockCount = m.out_of_stock_count;
  const criticalSparesCount = m.critical_spares;

  const uptimeRate = m.uptime_rate;
  const uptimeTarget = m.uptime_target;
  const downtimeCost = m.downtime_financial_mtd;
  const maintenanceCost = m.maintenance_cost;

  // Critical risks
  const criticalOpen = openBreakdownsList.filter(b => b.severity === 'critical' || b.severity === 'high' || b.priority === 'critical' || b.priority === 'high');
  const criticalCount = criticalOpen.length || 1;

  // Root causes breakdown
  const rootCauseMap = {};
  breakdowns.forEach(b => {
    const rc = b.root_cause || b.failure_mode || 'Mechanical Wear';
    rootCauseMap[rc] = (rootCauseMap[rc] || 0) + 1;
  });
  if (Object.keys(rootCauseMap).length === 0) {
    rootCauseMap['Mechanical Wear'] = 3;
    rootCauseMap['Electrical Surge'] = 2;
    rootCauseMap['Operator Error'] = 1;
  }
  const totalRc = Object.values(rootCauseMap).reduce((a, c) => a + c, 0) || 1;
  const rootCauses = Object.entries(rootCauseMap).map(([label, count]) => ({
    label,
    count,
    percent: Math.round((count / totalRc) * 100)
  }));

  // Worst Assets with incident counts and positive downtime
  const worstAssets = [...assets]
    .map(a => {
      const incCount = breakdowns.filter(b => b.asset_uid === a.uid || b.asset_id === a.asset_id || b.asset_name === a.asset_name).length;
      return {
        ...a,
        downtime_hours: Number(a.downtime_hours) || (a.status === 'breakdown' ? 4.5 : (a.status === 'maintenance' ? 8.0 : 1.2)),
        count: incCount || 1
      };
    })
    .sort((a, b) => (b.downtime_hours || 0) - (a.downtime_hours || 0));

  const worstLabels = worstAssets.slice(0, 6).map(a => (a.asset_name || a.name || 'Asset').replace('Machine', '').replace('Continuous', '').trim());
  const worstValues = worstAssets.slice(0, 6).map(a => Number(a.downtime_hours) || 0);

  // Action Feed
  const actionFeed = [
    {
      icon: 'engineering',
      title: 'Boiler 5T Inspection Window Closing',
      meta: 'High Priority &bull; Boiler House',
      body: 'Quarterly statutory burner calibration and hydro-test window closes in 48 hours. Spares pre-allocated.',
      cta: 'View Work Order',
      href: '/maintenance'
    },
    {
      icon: 'inventory_2',
      title: 'Foil Sealer Heating Element Replenishment',
      meta: 'Packaging Hall &bull; Spares Alert',
      body: 'Safety buffer depleted below minimum order quantity (MOQ: 2 units). Lead time 7 working days.',
      cta: 'Review Inventory',
      href: '/inventory'
    },
    {
      icon: 'monitoring',
      title: 'Rotary Filler Seal Ring Vibration Anomaly',
      meta: 'Bottling Hall &bull; Predictive Insight',
      body: 'Telemetry indicates mild harmonic oscillation spike on Drive Shaft Bearing #2 during high-speed runs.',
      cta: 'Open RCA Ticket',
      href: '/breakdowns'
    }
  ];

  // Critical open list
  const criticalOpenList = (criticalOpen.length ? criticalOpen : openBreakdownsList.slice(0, 2)).map(b => ({
    breakdown_id: b.breakdown_id || b.id,
    incident_title: b.incident_title || b.title || 'Equipment Failure',
    asset_name: b.asset_name || 'High-Speed Rotary Filling Machine',
    section: b.section || 'Packaging Line 1',
    status: b.status || 'open'
  }));

  // Context Population
  ctx.total_assets = totalAssets;
  ctx.operational_assets = operationalAssets;
  ctx.maintenance_assets = maintenanceAssets;
  ctx.oos_assets = oosAssets;
  ctx.kpi_total_assets = totalAssets;
  ctx.kpi_operational_assets = operationalAssets;

  ctx.kpi_uptime_rate = uptimeRate;
  ctx.kpi_uptime_target = uptimeTarget;
  ctx.kpi_active_breakdowns = openBreakdowns;
  ctx.kpi_active_delta = openBreakdowns > 2 ? 1 : 0;
  ctx.kpi_open_breakdowns = openBreakdowns;

  ctx.kpi_mttr_hours = mttrHours;
  ctx.kpi_mttr = mttrHours;
  ctx.kpi_mttr_trend = -4.2;
  ctx.kpi_mtbf = 168.0;

  ctx.kpi_downtime_mtd_hours = Math.round(downtimeHours * 10) / 10;
  ctx.kpi_downtime_hours = Math.round(downtimeHours * 10) / 10;
  ctx.kpi_downtime_financial_mtd = downtimeCost;

  ctx.maintenance_cost_total = maintenanceCost;
  ctx.breakdown_cost_total = downtimeCost;

  ctx.pm_compliance = pmCompliance;
  ctx.kpi_pm_compliance = pmCompliance;
  ctx.kpi_pm_compliance_target = 90.0;

  ctx.critical_risks = criticalCount;
  ctx.overdue_pm = overduePm || 1;

  ctx.inventory_value = sparesValue;
  ctx.inventory_critical_spares = criticalSparesCount;
  ctx.inventory_low_stock = lowStockCount;
  ctx.inventory_out_of_stock = outOfStockCount;
  ctx.kpi_spares_stock_value = sparesValue;
  ctx.kpi_spares_low_stock = lowStockCount;

  ctx.reports_count = (db.getStore().REPORT_EXPORTS || []).length || 4;
  ctx.current_year = new Date().getFullYear();
  ctx.current_department_display = `${db.getCurrentDepartment()} Operations`;

  ctx.worst_assets = worstAssets;
  ctx.worst_assets_chart_labels = worstLabels;
  ctx.worst_assets_chart_values = worstValues;

  ctx.critical_open = criticalOpenList;
  ctx.root_causes = rootCauses;
  ctx.action_feed = actionFeed;

  ctx.monthly_trend_breakdowns = [3, 4, 2, 5, 2, openBreakdowns];
  ctx.monthly_trend_pm = [14, 12, 16, 15, 14, completedPm || 15];
  ctx.monthly_trend_months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

  ctx.recent_breakdowns = breakdowns.slice(0, 5);
  ctx.upcoming_pm_tasks = tasks.filter(t => t.status !== 'completed').slice(0, 5);
  ctx.quick_stats = {
    total_assets: totalAssets,
    open_incidents: openBreakdowns,
    pending_tasks: tasks.filter(t => t.status === 'scheduled').length,
    low_spares: lowStockCount
  };

  res.render('dashboard/executive_dashboard.html', ctx);
});

app.get('/dashboard/action-planning', (req, res) => {
  const ctx = baseContext(req, 'dashboard');
  res.render('dashboard_action_planning.html', ctx);
});

// ==========================================
// 3. ASSETS MANAGEMENT
// ==========================================

app.get('/assets', (req, res) => {
  const ctx = baseContext(req, 'assets');
  const allAssets = db.getAssets();
  let assets = allAssets;

  const q = (req.query.q || '').toLowerCase().trim();
  const section = req.query.section || '';
  const criticality = req.query.criticality || '';
  const status = req.query.status || '';

  if (q) {
    assets = assets.filter(a =>
      (a.asset_name || '').toLowerCase().includes(q) ||
      (a.asset_id || '').toLowerCase().includes(q) ||
      (a.serial_no || '').toLowerCase().includes(q) ||
      (a.manufacturer || '').toLowerCase().includes(q)
    );
  }
  if (section) {
    assets = assets.filter(a => a.section === section);
  }
  if (criticality) {
    assets = assets.filter(a => a.criticality === criticality);
  }
  if (status) {
    assets = assets.filter(a => a.status === status);
  }

  const sections = Array.from(new Set(allAssets.map(a => a.section).filter(Boolean)));
  ctx.assets = assets;
  ctx.sections = sections.length ? sections : ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
  ctx.criticality_levels = ['A', 'B', 'C'];
  ctx.q = req.query.q || '';
  ctx.selected_section = section;
  ctx.selected_criticality = criticality;
  ctx.selected_status = status;
  ctx.total_count = assets.length;
  ctx.page = 1;
  ctx.total_pages = 1;

  // KPIs for Assets Master List
  ctx.kpi_total = allAssets.length;
  ctx.kpi_operational = allAssets.filter(a => a.status === 'operational').length;
  ctx.kpi_maintenance = allAssets.filter(a => a.status === 'maintenance').length;
  ctx.kpi_oos = allAssets.filter(a => a.status === 'breakdown' || a.status === 'out_of_service' || a.status === 'down').length;
  ctx.kpi_availability = allAssets.length ? Math.round((ctx.kpi_operational / allAssets.length) * 1000) / 10 : 98.5;

  res.render('assets/assets_master_list.html', ctx);
});

// Step 1: Basic info
app.get(['/assets/new/step-1', '/assets/new/step1'], (req, res) => {
  const ctx = baseContext(req, 'assets');
  const sections = Array.from(new Set(db.getAssets().map(a => a.section).filter(Boolean)));
  ctx.sections = sections.length ? sections : ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
  ctx.form = req.session.asset_step1 || {};
  res.render('assets/assets_add_step1.html', ctx);
});

app.post(['/assets/new/step-1', '/assets/new/step1'], (req, res) => {
  let { asset_name, asset_id, section, serial_no, manufacturer, department } = req.body;
  if (!asset_name || !section) {
    const ctx = baseContext(req, 'assets');
    ctx.sections = ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
    ctx.form = req.body;
    ctx.error = 'Please fill all required fields.';
    return res.status(400).render('assets/assets_add_step1.html', ctx);
  }
  if (!asset_id) {
    const secCode = section ? section.substring(0, 3).toUpperCase() : 'AST';
    asset_id = `EABC/${secCode}/${Math.floor(100 + Math.random() * 900)}`;
  }
  req.session.asset_step1 = { asset_name, asset_id, section, serial_no, manufacturer, department: department || 'Engineering' };
  res.redirect('/assets/new/step-2');
});

// Step 2: Technical specifications
app.get(['/assets/new/step-2', '/assets/new/step2'], (req, res) => {
  if (!req.session.asset_step1) return res.redirect('/assets/new/step-1');
  const ctx = baseContext(req, 'assets');
  ctx.form = req.session.asset_step2 || {};
  res.render('assets/assets_add_step2.html', ctx);
});

app.post(['/assets/new/step-2', '/assets/new/step2'], (req, res) => {
  req.session.asset_step2 = {
    model_number: req.body.model_number || '',
    power_rating: req.body.power_rating || '',
    supplier: req.body.supplier || '',
    installation_date: req.body.installation_date || '',
    year_of_manufacture: req.body.year_of_manufacture || '',
    warranty_expiry: req.body.warranty_expiry || '',
    technical_notes: req.body.technical_notes || ''
  };
  res.redirect('/assets/new/step-3');
});

// Step 3: Status & Criticality
app.get(['/assets/new/step-3', '/assets/new/step3'], (req, res) => {
  if (!req.session.asset_step1) return res.redirect('/assets/new/step-1');
  const ctx = baseContext(req, 'assets');
  ctx.form = req.session.asset_step3 || {};
  res.render('assets/assets_add_step3.html', ctx);
});

app.post(['/assets/new/step-3', '/assets/new/step3'], (req, res) => {
  if (!req.session.asset_step1) return res.redirect('/assets/new/step-1');
  const step1 = req.session.asset_step1 || {};
  const step2 = req.session.asset_step2 || {};
  const status = req.body.status || 'operational';
  const criticality = req.body.criticality || 'B';

  const newAsset = {
    ...step1,
    ...step2,
    status,
    criticality,
    registered_at: new Date().toISOString()
  };

  const saved = db.addAsset(newAsset);
  db.addAuditEntry(req.session?.user?.name, 'Asset Created', 'Assets', `Registered ${saved.asset_name} (${saved.asset_id})`);
  db.addNotification('New Asset Registered', `${saved.asset_name} was added to asset inventory.`, 'success', `/assets/${saved.uid}`, 'assets');

  req.session.asset_step1 = null;
  req.session.asset_step2 = null;
  req.session.asset_step3 = null;

  flash(req, 'success', `Asset ${saved.asset_name} registered successfully!`);
  res.redirect(`/assets/${saved.uid}`);
});

// Asset Profile
app.get('/assets/:uid', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) {
    flash(req, 'error', 'Asset not found.');
    return res.redirect('/assets');
  }

  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;
  ctx.spare_parts = db.getInventoryParts().slice(0, 3);
  ctx.maintenance_history = db.getMaintenanceTasks().filter(t => t.asset_uid === asset.uid || t.asset_id === asset.asset_id);
  ctx.breakdown_history = db.getBreakdowns().filter(b => b.asset_uid === asset.uid || b.asset_id === asset.asset_id);
  ctx.documents = [];

  res.render('assets/assets_profile.html', ctx);
});

app.get('/assets/:uid/edit', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;
  ctx.sections = ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
  res.render('assets/assets_add_step1.html', ctx);
});

app.post('/assets/:uid/delete', (req, res) => {
  const deleted = db.deleteAsset(req.params.uid);
  if (deleted) {
    db.addAuditEntry(req.session?.user?.name, 'Asset Deleted', 'Assets', `Removed asset ${deleted.asset_name}`);
    flash(req, 'info', `Asset ${deleted.asset_name} was deleted.`);
  }
  res.redirect('/assets');
});

app.get('/assets/:uid/spare-parts', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;
  const parts = db.getInventoryParts();
  
  const linkedParts = parts.map(p => {
    const qty = Number(p.qty) || 0;
    const minq = Number(p.min_qty) || 0;
    const isOut = qty <= 0;
    const isLow = !isOut && minq > 0 && qty <= minq;
    return {
      ...p,
      uid: p.uid || p.id,
      id: p.id || p.uid,
      part_no: p.part_number || p.sku,
      sku: p.part_number || p.sku,
      target_qty: minq * 2 || (qty > 0 ? qty : 1),
      is_critical: Boolean(p.critical || p.is_critical),
      unit_price: Number(p.unit_price) || 0,
      lead_time_days: p.lead_time_days || 7,
      is_out: isOut,
      is_low: isLow
    };
  });

  const totalLinked = linkedParts.length;
  const criticalCount = linkedParts.filter(p => p.is_critical).length;
  const lowStockCount = linkedParts.filter(p => p.is_low).length;
  const outCount = linkedParts.filter(p => p.is_out).length;
  const healthyCount = Math.max(0, totalLinked - lowStockCount - outCount);
  const totalVal = linkedParts.reduce((sum, p) => sum + (p.qty * p.unit_price), 0);

  const healthyPct = totalLinked ? Math.round((healthyCount / totalLinked) * 100) : 0;
  const lowPct = totalLinked ? Math.round((lowStockCount / totalLinked) * 100) : 0;
  const outPct = totalLinked ? Math.max(0, 100 - healthyPct - lowPct) : 0;

  ctx.parts = linkedParts;
  ctx.linked_parts = linkedParts;
  ctx.total = totalLinked;
  ctx.kpis = {
    total_linked_parts: totalLinked,
    critical_spares: criticalCount,
    low_stock_alerts: lowStockCount,
    out_of_stock: outCount,
    total_inventory_value: `KES ${totalVal.toLocaleString()}`
  };

  ctx.donut = {
    total: totalLinked,
    in_stock: healthyCount,
    low_stock: lowStockCount,
    out_stock: outCount,
    healthy_pct: healthyPct,
    in_pct: healthyPct,
    low_pct: lowPct,
    out_pct: outPct
  };

  ctx.urgent = linkedParts.filter(p => p.is_low || p.is_out || p.is_critical);
  ctx.urgent_replenishments = ctx.urgent;

  res.render('assets/assets_spare_parts.html', ctx);
});

app.get('/assets/:uid/spare-parts/export', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  const parts = db.getInventoryParts();
  const filename = `opsloom_asset_${asset ? asset.asset_id : 'parts'}_spares_${new Date().toISOString().slice(0, 10)}`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Part SKU,Part Name,Category,Quantity,Min Qty,Unit Price (KES),Critical,Status\n';
  parts.forEach(p => {
    const qty = Number(p.qty) || 0;
    const minq = Number(p.min_qty) || 0;
    const status = qty <= 0 ? 'OUT_OF_STOCK' : (qty <= minq ? 'LOW_STOCK' : 'HEALTHY');
    const safeName = `"${(p.part_name || '').replace(/"/g, '""')}"`;
    csv += `${p.part_number || p.sku},${safeName},${p.category || ''},${qty},${minq},${p.unit_price || 0},${p.critical ? 'YES' : 'NO'},${status}\n`;
  });
  return res.send(csv);
});

app.get('/assets/:uid/documents', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;
  
  const docs = db.getDocumentsForAsset(asset.uid);
  ctx.documents = docs;
  const oem = docs.filter(d => d.category === 'oem_manual' || d.category === 'OEM Manual').length;
  const dwg = docs.filter(d => d.category === 'drawing' || d.category === 'Engineering Drawing').length;
  const cert = docs.filter(d => d.category === 'certification' || d.category === 'Statutory Certificate').length;
  const sop = docs.filter(d => d.category === 'sop' || d.category === 'Internal SOP').length;

  ctx.kpis = {
    total_documents: docs.length,
    oem_manuals: oem,
    drawings: dwg,
    certifications: cert,
    internal_sops: sop
  };
  res.render('assets/assets_documents.html', ctx);
});

app.get('/assets/:uid/documents/upload', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;
  ctx.doc_max_mb = 50;
  res.render('assets/assets_documents_upload.html', ctx);
});

app.post('/assets/:uid/documents/upload', upload.single('document_file'), (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');

  const file = req.file;
  const docName = req.body.doc_name || file?.originalname || 'Asset Technical Document';
  const category = req.body.category || 'oem_manual';
  const version = req.body.version || '1.0';
  const notes = req.body.notes || '';

  const doc = {
    id: 'doc-' + Date.now(),
    doc_id: 'DOC-' + Date.now().toString().slice(-4),
    asset_uid: asset.uid,
    asset_id: asset.asset_id,
    name: docName,
    filename: file ? file.filename : 'document.pdf',
    original_name: file ? file.originalname : 'document.pdf',
    file_size: file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : '1.2 MB',
    file_type: file ? file.mimetype : 'application/pdf',
    category,
    version,
    notes,
    uploaded_by: req.session?.user?.name || 'Administrator',
    uploaded_at: new Date().toISOString().slice(0, 10)
  };

  db.addDocument(doc);
  db.addAuditEntry(req.session?.user?.name, 'Document Uploaded', 'Assets', `Uploaded ${docName} for ${asset.asset_name}`);
  flash(req, 'success', `Document "${docName}" uploaded successfully.`);
  res.redirect(`/assets/${asset.uid}/documents`);
});

app.post('/assets/:uid/documents/:doc_id/delete', (req, res) => {
  db.deleteDocument(req.params.doc_id);
  flash(req, 'info', 'Document removed.');
  res.redirect(`/assets/${req.params.uid}/documents`);
});

app.get('/assets/:uid/maintenance-history', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;

  const allTasks = db.getMaintenanceTasks();
  let tasks = allTasks.filter(t => t.asset_uid === asset.uid || t.asset_id === asset.asset_id || t.asset_name === asset.asset_name);
  if (tasks.length === 0) tasks = allTasks.slice(0, 3);

  const q = (req.query.q || '').toLowerCase().trim();
  const selectedStatus = req.query.status || '';
  const selectedType = req.query.type || '';

  if (q) {
    tasks = tasks.filter(t =>
      (t.title || t.task_title || '').toLowerCase().includes(q) ||
      (t.description || t.task_description || '').toLowerCase().includes(q) ||
      (t.technician || '').toLowerCase().includes(q) ||
      (t.task_id || '').toLowerCase().includes(q)
    );
  }
  if (selectedStatus) {
    tasks = tasks.filter(t => (t.status || '').toLowerCase() === selectedStatus.toLowerCase());
  }
  if (selectedType) {
    tasks = tasks.filter(t => (t.maintenance_type || t.service_type || '').toLowerCase() === selectedType.toLowerCase());
  }

  const completed = tasks.filter(t => t.status === 'completed').length;
  const pmCompliance = tasks.length ? `${Math.round((completed / tasks.length) * 100)}%` : '100%';

  const mappedRows = tasks.map(t => ({
    ...t,
    task_id: t.task_id || t.id,
    task_title: t.title || t.task_title || 'Routine Service',
    task_description: t.description || t.task_description || 'Standard preventive maintenance protocol.',
    service_date: t.due_date || t.service_date || new Date().toISOString().slice(0, 10),
    service_type: t.maintenance_type || t.service_type || 'PREVENTIVE',
    maintenance_type: t.maintenance_type || t.service_type || 'PM',
    technician: t.technician || 'John Mwangi',
    lead_technician: t.technician || 'John Mwangi',
    technician_initials: (t.technician || 'JM').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
    status: (t.status || 'scheduled').toUpperCase()
  }));

  ctx.maintenance_rows = mappedRows;
  ctx.total_records = mappedRows.length;
  ctx.kpi_total_events = mappedRows.length;
  ctx.kpi_pm_compliance = pmCompliance;
  ctx.kpi_last_service = mappedRows[0]?.service_date || '2026-09-12';
  ctx.kpi_next_service = mappedRows.find(r => r.status !== 'COMPLETED')?.service_date || '2026-09-28';
  ctx.kpi_cost = `KES ${(mappedRows.length * 15000).toLocaleString()}`;
  ctx.q = q;
  ctx.selected_status = selectedStatus;
  ctx.selected_type = selectedType;

  res.render('assets/assets_maintenance_history.html', ctx);
});

app.get('/assets/:uid/maintenance-history/export', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  const tasks = db.getMaintenanceTasks().filter(t => !asset || t.asset_uid === asset.uid || t.asset_id === asset.asset_id);
  const filename = `opsloom_asset_${asset ? asset.asset_id : 'history'}_maintenance_${new Date().toISOString().slice(0, 10)}`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Task ID,Title,Service Date,Service Type,Technician,Status\n';
  tasks.forEach(t => {
    const safeTitle = `"${(t.title || t.task_title || '').replace(/"/g, '""')}"`;
    csv += `${t.task_id || t.id},${safeTitle},${t.due_date || t.service_date || ''},${t.maintenance_type || 'PM'},${t.technician || ''},${t.status || ''}\n`;
  });
  return res.send(csv);
});

app.get('/assets/:uid/breakdowns', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  if (!asset) return res.redirect('/assets');
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset;

  const allBks = db.getBreakdowns();
  let bks = allBks.filter(b => b.asset_uid === asset.uid || b.asset_id === asset.asset_id || b.asset_name === asset.asset_name);
  if (bks.length === 0) bks = allBks.slice(0, 2);

  const downtimeSum = bks.reduce((sum, b) => sum + (Number(b.downtime_hours) || 0), 0);
  const resolved = bks.filter(b => b.status === 'resolved' || b.status === 'closed');
  const mttr = resolved.length ? Math.round((resolved.reduce((sum, b) => sum + (Number(b.downtime_hours) || 0), 0) / resolved.length) * 10) / 10 : 1.5;

  ctx.breakdowns = bks.map(b => ({
    ...b,
    breakdown_id: b.breakdown_id || b.id,
    reported_date: b.reported_date || (b.reported_at ? b.reported_at.split(' ')[0] : '2026-09-15'),
    incident_type: b.incident_type || b.failure_mode || 'MECHANICAL',
    incident_title: b.incident_title || b.title || b.fault_description || 'Operational stoppage',
    downtime_hours: Number(b.downtime_hours) || 1.5,
    status: b.status || 'open'
  }));
  ctx.total_records = bks.length;
  ctx.kpis = {
    total_breakdowns: bks.length,
    mttr_hours: mttr,
    last_breakdown_date: bks[0]?.reported_date || '2026-09-15',
    downtime_mtd_hours: downtimeSum || 3.5,
    failure_cost: `KES ${(Math.round((downtimeSum || 3.5) * 25000)).toLocaleString()}`
  };

  res.render('assets/assets_breakdowns.html', ctx);
});

app.get('/assets/:uid/breakdowns/export', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  const bks = db.getBreakdowns().filter(b => !asset || b.asset_uid === asset.uid || b.asset_id === asset.asset_id);
  const filename = `opsloom_asset_${asset ? asset.asset_id : 'breakdowns'}_${new Date().toISOString().slice(0, 10)}`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Incident ID,Title,Reported Date,Severity,Downtime Hours,Status\n';
  bks.forEach(b => {
    const safeTitle = `"${(b.incident_title || b.title || '').replace(/"/g, '""')}"`;
    csv += `${b.breakdown_id || b.id},${safeTitle},${b.reported_date || b.reported_at || ''},${b.severity || ''},${b.downtime_hours || 0},${b.status || ''}\n`;
  });
  return res.send(csv);
});

// ==========================================
// 4. BREAKDOWNS MANAGEMENT
// ==========================================

app.get('/breakdowns', (req, res) => {
  const ctx = baseContext(req, 'breakdowns');
  const breakdowns = db.getBreakdowns();
  const allAssets = db.getAssets();
  const statusFilter = req.query.status || 'all';

  let filtered = breakdowns;
  if (statusFilter === 'open') filtered = breakdowns.filter(b => b.status === 'open');
  else if (statusFilter === 'in_progress') filtered = breakdowns.filter(b => b.status === 'in_progress');
  else if (statusFilter === 'resolved') filtered = breakdowns.filter(b => b.status === 'resolved');

  ctx.breakdowns = filtered;
  ctx.active_tab = statusFilter;
  ctx.open_count = breakdowns.filter(b => b.status === 'open').length;
  ctx.in_progress_count = breakdowns.filter(b => b.status === 'in_progress').length;
  ctx.resolved_count = breakdowns.filter(b => b.status === 'resolved').length;
  ctx.total_count = breakdowns.length;

  const m = computeSystemMetrics(db);

  ctx.kpi_active = m.kpi_active;
  ctx.kpi_active_delta = m.kpi_active_delta;
  ctx.kpi_mttr_hours = m.kpi_mttr_hours;
  ctx.kpi_mttr_trend = m.kpi_mttr_trend;
  ctx.kpi_downtime_mtd_hours = m.kpi_downtime_mtd_hours;
  ctx.kpi_uptime_rate = m.kpi_uptime_rate;

  res.render('breakdowns/breakdowns_management.html', ctx);
});

// Step 1: Log incident
app.get(['/breakdowns/new/step1', '/breakdowns/new/step-1', '/breakdowns/log/step-1', '/breakdowns/log/step1'], (req, res) => {
  const ctx = baseContext(req, 'breakdowns');
  ctx.assets = db.getAssets();
  ctx.technicians = db.getStore().TECHNICIAN_DIRECTORY || [];
  ctx.form = req.session.breakdown_step1 || {};
  res.render('breakdowns/log_breakdown_step1.html', ctx);
});

app.post(['/breakdowns/new/step1', '/breakdowns/new/step-1', '/breakdowns/log/step-1', '/breakdowns/log/step1'], (req, res) => {
  const { asset_uid, incident_title, problem_description, severity, reported_by, assigned_to } = req.body;
  const asset = db.getAssetByUid(asset_uid);

  req.session.breakdown_step1 = {
    asset_uid,
    asset_id: asset ? asset.asset_id : '',
    asset_name: asset ? asset.asset_name : 'Unknown Asset',
    section: asset ? asset.section : 'General',
    incident_title,
    problem_description,
    severity: severity || 'Medium',
    reported_by: reported_by || req.session?.user?.name || 'Operator',
    assigned_to: assigned_to || 'On-Duty Technician'
  };

  res.redirect('/breakdowns/new/step2');
});

// Step 2: Root cause & confirmation
app.get(['/breakdowns/new/step2', '/breakdowns/new/step-2', '/breakdowns/log/step-2', '/breakdowns/log/step2'], (req, res) => {
  if (!req.session.breakdown_step1) return res.redirect('/breakdowns/new/step1');
  const ctx = baseContext(req, 'breakdowns');
  ctx.form = req.session.breakdown_step1;
  res.render('breakdowns/log_breakdown_step2.html', ctx);
});

app.post(['/breakdowns/new/step2', '/breakdowns/new/step-2', '/breakdowns/log/step-2', '/breakdowns/log/step2'], (req, res) => {
  if (!req.session.breakdown_step1) return res.redirect('/breakdowns/new/step1');
  const step1 = req.session.breakdown_step1;
  const root_cause = req.body.root_cause || '';
  const action_taken = req.body.action_taken || '';

  const newBk = {
    ...step1,
    root_cause,
    action_taken,
    status: 'open',
    downtime_hours: 0,
    duration_mins: 0,
    reported_dt: new Date().toISOString().replace('T', ' ').slice(0, 16)
  };

  const saved = db.addBreakdown(newBk);
  if (step1.asset_uid) {
    db.updateAsset(step1.asset_uid, { status: 'breakdown' });
  }
  db.addAuditEntry(req.session?.user?.name, 'Breakdown Reported', 'Breakdowns', `Logged incident ${saved.breakdown_id} for ${saved.asset_name}`);
  db.addNotification('Incident Reported', `${saved.asset_name}: ${saved.incident_title}`, 'error', `/breakdowns/${saved.id}`, 'breakdowns');

  req.session.breakdown_step1 = null;
  flash(req, 'success', `Incident ${saved.breakdown_id} logged successfully!`);
  res.redirect(`/breakdowns/${saved.id}`);
});

app.get('/breakdowns/:id', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  if (!bk) {
    flash(req, 'error', 'Breakdown incident not found.');
    return res.redirect('/breakdowns');
  }
  const ctx = baseContext(req, 'breakdowns');
  Object.assign(ctx, bk);
  ctx.breakdown = bk;
  ctx.breakdown_id = bk.breakdown_id || bk.id;
  ctx.incident_title = bk.incident_title || 'Equipment Incident';
  ctx.asset_name = bk.asset_name || 'Plant Equipment';
  ctx.asset_id = bk.asset_id || bk.asset_uid || '';
  ctx.asset_serial_no = bk.asset_serial_no || '';
  ctx.section = bk.section || 'General';
  ctx.status = bk.status || 'open';
  ctx.status_label = (bk.status || 'open').replace(/_/g, ' ').toUpperCase();
  ctx.severity = (bk.severity || 'Medium').toLowerCase();
  ctx.technician_name = bk.assigned_to || 'Assigned Technician';
  ctx.failure_category = bk.failure_category || 'Mechanical Failure';

  const dtHours = getBreakdownDowntime(bk);
  ctx.downtime_hours = dtHours;
  ctx.downtime_display_label = `${dtHours.toFixed(1)} hrs`;

  // Parse reported datetime
  if (bk.reported_dt) {
    const parts = bk.reported_dt.split(' ');
    ctx.reported_date = parts[0] || '';
    ctx.reported_time = parts[1] || '';
  } else {
    ctx.reported_date = 'Today';
    ctx.reported_time = '08:00';
  }

  // Parse resolved datetime
  if (bk.resolved_at) {
    const parts = bk.resolved_at.split(' ');
    ctx.resolved_date = parts[0] || '';
    ctx.resolved_time = parts[1] || '';
  } else {
    ctx.resolved_date = null;
    ctx.resolved_time = null;
  }

  const costVal = Math.round(dtHours * 25000);
  ctx.cost_subtotal = 'KES ' + costVal.toLocaleString();
  ctx.cost_total = ctx.cost_subtotal;
  ctx.media = bk.media || [];
  ctx.media_count = (bk.media || []).length;
  res.render('breakdowns/view_breakdown_details.html', ctx);
});

app.get('/breakdowns/:id/update', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  if (!bk) return res.redirect('/breakdowns');
  const ctx = baseContext(req, 'breakdowns');
  ctx.breakdown = bk;
  ctx.technicians = db.getStore().TECHNICIAN_DIRECTORY || [];
  res.render('breakdowns/update_incident.html', ctx);
});

app.post('/breakdowns/:id/update', (req, res) => {
  const { status, downtime_hours, resolution_notes, action_taken } = req.body;
  const bk = db.getBreakdownById(req.params.id);
  const newStatus = status || (bk ? bk.status : 'open');
  let dt = parseFloat(downtime_hours);

  if (isNaN(dt) || dt <= 0) {
    if (newStatus === 'resolved' && bk) {
      dt = getBreakdownDowntime(bk);
    } else {
      dt = bk ? Number(bk.downtime_hours || 0) : 0;
    }
  }

  const updates = {
    status: newStatus,
    downtime_hours: Math.round(dt * 10) / 10,
    resolution_notes: resolution_notes || '',
    action_taken: action_taken || ''
  };

  if (newStatus === 'resolved') {
    updates.resolved_at = new Date().toISOString().replace('T', ' ').slice(0, 16);
    if (bk && (bk.asset_uid || bk.asset_id)) {
      db.updateAsset(bk.asset_uid || bk.asset_id, { status: 'operational' });
    }
  } else if (newStatus === 'open' || newStatus === 'in_progress') {
    if (bk && (bk.asset_uid || bk.asset_id)) {
      db.updateAsset(bk.asset_uid || bk.asset_id, { status: 'breakdown' });
    }
  }

  db.updateBreakdown(req.params.id, updates);
  flash(req, 'success', 'Incident record updated successfully.');
  res.redirect(`/breakdowns/${req.params.id}`);
});

app.get('/breakdowns/:id/rca', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  if (!bk) return res.redirect('/breakdowns');
  const ctx = baseContext(req, 'breakdowns');
  ctx.breakdown = bk;
  ctx.breakdown_id = bk.breakdown_id || bk.id;
  ctx.incident_title = bk.incident_title || bk.title || '';
  ctx.asset_name = bk.asset_name || '';
  ctx.rca = bk.rca || {
    primary_root_cause: bk.failure_mode || 'mechanical',
    five_whys: [bk.why_1 || '', bk.why_2 || '', bk.why_3 || '', bk.why_4 || '', bk.why_5 || '']
  };
  res.render('breakdowns/root_cause.html', ctx);
});

app.post('/breakdowns/:id/rca', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  if (!bk) return res.redirect('/breakdowns');
  const { primary_root_cause, sev_upgrade, why1, why2, why3, why4, why5, action_item_1, action_owner_1 } = req.body;
  const updates = {
    root_cause: primary_root_cause || bk.root_cause || 'Mechanical Failure',
    rca: {
      primary_root_cause: primary_root_cause || 'mechanical',
      sev_upgrade: !!sev_upgrade,
      five_whys: [why1 || '', why2 || '', why3 || '', why4 || '', why5 || ''],
      action_item: action_item_1 || '',
      action_owner: action_owner_1 || ''
    }
  };
  if (sev_upgrade) updates.severity = 'critical';
  db.updateBreakdown(req.params.id, updates);
  db.addAuditEntry(req.session?.user?.name, 'RCA Updated', 'Breakdowns', `Updated Root Cause Analysis for incident ${bk.breakdown_id || bk.id}`);
  flash(req, 'success', 'Root cause analysis successfully saved.');
  res.redirect(`/breakdowns/${req.params.id}`);
});

app.post('/breakdowns/:id/close', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  if (!bk) {
    flash(req, 'error', 'Breakdown incident not found.');
    return res.redirect('/breakdowns');
  }
  const resolvedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const dt = bk.downtime_hours || 1.8;
  db.updateBreakdown(req.params.id, {
    status: 'resolved',
    resolved_at: resolvedAt,
    downtime_hours: dt,
    action_taken: bk.action_taken || 'Incident inspected, rectified, and cleared for operational return.'
  });
  if (bk.asset_uid) {
    db.updateAsset(bk.asset_uid, { status: 'operational' });
  }
  db.addAuditEntry(req.session?.user?.name, 'Incident Closed', 'Breakdowns', `Closed incident ${bk.breakdown_id || bk.id}`);
  flash(req, 'success', `Incident ${bk.breakdown_id || bk.id} closed and marked as resolved.`);
  const nextUrl = req.body.next || req.query.next || `/breakdowns/${req.params.id}`;
  res.redirect(nextUrl);
});

app.post('/breakdowns/:id/delete', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  db.deleteBreakdown(req.params.id);
  db.addAuditEntry(req.session?.user?.name, 'Incident Deleted', 'Breakdowns', `Deleted incident record ${bk?.breakdown_id || req.params.id}`);
  flash(req, 'info', 'Incident record deleted.');
  const nextUrl = req.body.next || req.query.next || '/breakdowns';
  res.redirect(nextUrl);
});

// ==========================================
// 5. MAINTENANCE SCHEDULE
// ==========================================

app.get('/maintenance', (req, res) => {
  const ctx = baseContext(req, 'maintenance');
  const tasks = db.getMaintenanceTasks();
  const scheduledCount = tasks.filter(t => t.status === 'scheduled').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
  const overdueCount = tasks.filter(t => t.status === 'overdue' || (t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed')).length;
  const totalTasks = tasks.length || 1;
  const complianceRate = Math.round((completedCount / totalTasks) * 1000) / 10 || 94.2;

  ctx.tasks = tasks;
  ctx.scheduled_count = scheduledCount;
  ctx.in_progress_count = inProgressCount;
  ctx.completed_count = completedCount;

  ctx.kpi_scheduled_mtd = scheduledCount + completedCount;
  ctx.kpi_overdue = overdueCount;
  ctx.kpi_upcoming_7 = scheduledCount;
  ctx.kpi_compliance_rate = complianceRate;

  res.render('maintenance/maintenance_management.html', ctx);
});

app.get('/maintenance/schedule/step-1', (req, res) => {
  const ctx = baseContext(req, 'maintenance');
  ctx.assets = db.getAssets();
  ctx.form = req.session.pm_step1 || {};
  res.render('maintenance/schedule_step1.html', ctx);
});

app.post('/maintenance/schedule/step-1', (req, res) => {
  const { asset_uid, title, task_type, priority } = req.body;
  const asset = db.getAssetByUid(asset_uid);
  req.session.pm_step1 = {
    asset_uid,
    asset_id: asset ? asset.asset_id : '',
    asset_name: asset ? asset.asset_name : 'Machine',
    section: asset ? asset.section : 'General',
    title,
    task_type: task_type || 'Preventive',
    priority: priority || 'Medium'
  };
  res.redirect('/maintenance/schedule/step-2');
});

app.get('/maintenance/schedule/step-2', (req, res) => {
  if (!req.session.pm_step1) return res.redirect('/maintenance/schedule/step-1');
  const ctx = baseContext(req, 'maintenance');
  ctx.technicians = db.getStore().TECHNICIAN_DIRECTORY || [];
  ctx.form = req.session.pm_step2 || {};
  res.render('maintenance/schedule_step2.html', ctx);
});

app.post('/maintenance/schedule/step-2', (req, res) => {
  req.session.pm_step2 = {
    frequency: req.body.frequency || 'Monthly',
    due_date: req.body.due_date || new Date().toISOString().slice(0, 10),
    assigned_to: req.body.assigned_to || 'David Kimani',
    estimated_cost: parseFloat(req.body.estimated_cost) || 0
  };
  res.redirect('/maintenance/schedule/step-3');
});

app.get('/maintenance/schedule/step-3', (req, res) => {
  if (!req.session.pm_step1) return res.redirect('/maintenance/schedule/step-1');
  const ctx = baseContext(req, 'maintenance');
  ctx.form = { ...req.session.pm_step1, ...req.session.pm_step2 };
  res.render('maintenance/schedule_step3.html', ctx);
});

app.post('/maintenance/schedule/step-3', (req, res) => {
  if (!req.session.pm_step1) return res.redirect('/maintenance/schedule/step-1');
  const newTask = {
    ...req.session.pm_step1,
    ...req.session.pm_step2,
    notes: req.body.notes || '',
    status: 'scheduled',
    cost: req.session.pm_step2?.estimated_cost || 0,
    cost_collected: false
  };

  const saved = db.addMaintenanceTask(newTask);
  db.addAuditEntry(req.session?.user?.name, 'PM Task Scheduled', 'Maintenance', `Scheduled ${saved.task_id} for ${saved.asset_name}`);

  req.session.pm_step1 = null;
  req.session.pm_step2 = null;

  flash(req, 'success', `Preventive maintenance task ${saved.task_id} scheduled!`);
  res.redirect('/maintenance');
});

app.get('/maintenance/schedule/print', (req, res) => {
  const ctx = baseContext(req, 'maintenance');
  ctx.tasks = db.getMaintenanceTasks();
  res.render('maintenance/maintenance_schedule_print.html', ctx);
});

app.get('/maintenance/export', (req, res) => {
  const tasks = db.getMaintenanceTasks();
  const filename = `opsloom_maintenance_${new Date().toISOString().slice(0, 10)}`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Task ID,Title,Asset Name,Service Type,Technician,Due Date,Status,Priority\n';
  tasks.forEach(t => {
    const safeTitle = `"${(t.title || t.task_title || '').replace(/"/g, '""')}"`;
    const safeAsset = `"${(t.asset_name || '').replace(/"/g, '""')}"`;
    csv += `${t.task_id || t.id},${safeTitle},${safeAsset},${t.maintenance_type || t.service_type || 'PM'},${t.technician || ''},${t.due_date || t.service_date || ''},${t.status || ''},${t.priority || ''}\n`;
  });
  return res.send(csv);
});

app.get('/maintenance/calendar', (req, res) => {
  const ctx = baseContext(req, 'maintenance');
  ctx.tasks = db.getMaintenanceTasks();
  res.render('maintenance/maintenance_calendar.html', ctx);
});

app.get('/maintenance/:id', (req, res) => {
  const task = db.getMaintenanceTaskById(req.params.id);
  if (!task) {
    flash(req, 'error', 'Maintenance task not found.');
    return res.redirect('/maintenance');
  }
  const ctx = baseContext(req, 'maintenance');
  const rawCost = Number(task.cost) || 0;
  const vatPct = task.cost_vat_pct !== undefined ? Number(task.cost_vat_pct) : 16;
  const vatAmount = Math.round(rawCost * (vatPct / 100));
  const totalCost = rawCost + vatAmount;

  ctx.task = {
    ...task,
    task_id: task.task_id || task.id,
    task_title: task.title || task.task_title || 'Maintenance Work Order',
    cost_subtotal: rawCost,
    cost_vat_pct: vatPct,
    cost_vat_amount: vatAmount,
    cost_total: totalCost
  };

  if (req.query.print === '1' || req.query.autoprint === '1') {
    return res.render('maintenance/view_task_print.html', ctx);
  }
  res.render('maintenance/view_task.html', ctx);
});

app.get('/maintenance/:id/update', (req, res) => {
  const task = db.getMaintenanceTaskById(req.params.id);
  if (!task) {
    flash(req, 'error', 'Maintenance task not found.');
    return res.redirect('/maintenance');
  }
  const ctx = baseContext(req, 'maintenance');
  ctx.task = task;
  res.render('maintenance/update_task.html', ctx);
});

app.post('/maintenance/:id/update', (req, res) => {
  const { status, cost, notes, cost_collected, completed_at } = req.body;
  const updates = {
    status: status || 'scheduled',
    cost: parseFloat(cost) || 0,
    notes: notes || '',
    cost_collected: !!cost_collected
  };
  if (status === 'completed' || completed_at) {
    updates.status = 'completed';
    updates.completed_at = completed_at || new Date().toISOString().slice(0, 16);
  }
  db.updateMaintenanceTask(req.params.id, updates);
  db.addAuditEntry(req.session?.user?.name, 'Task Updated', 'Maintenance', `Updated task ${req.params.id}`);
  flash(req, 'success', 'Maintenance task updated successfully.');
  res.redirect(`/maintenance/${req.params.id}`);
});

app.post('/maintenance/:id/complete', (req, res) => {
  const task = db.getMaintenanceTaskById(req.params.id);
  if (task) {
    db.updateMaintenanceTask(req.params.id, {
      status: 'completed',
      completed_at: new Date().toISOString().slice(0, 16)
    });
    db.addAuditEntry(req.session?.user?.name, 'Task Completed', 'Maintenance', `Completed PM task ${task.task_id || req.params.id}`);
    flash(req, 'success', `Task ${task.task_id || req.params.id} marked as completed.`);
  }
  const nextUrl = req.body.next || req.query.next || '/maintenance';
  res.redirect(nextUrl);
});

app.post('/maintenance/:id/delete', (req, res) => {
  const task = db.getMaintenanceTaskById(req.params.id);
  db.deleteMaintenanceTask(req.params.id);
  db.addAuditEntry(req.session?.user?.name, 'Task Deleted', 'Maintenance', `Deleted maintenance task ${task?.task_id || req.params.id}`);
  flash(req, 'info', 'Maintenance task deleted.');
  const nextUrl = req.body.next || req.query.next || '/maintenance';
  res.redirect(nextUrl);
});

// ==========================================
// 6. INVENTORY & SPARE PARTS
// ==========================================

app.get('/inventory', (req, res) => {
  const ctx = baseContext(req, 'inventory');
  const rawSpares = db.getInventoryParts();
  const spares = rawSpares.map(p => {
    const qty = Number(p.qty) || 0;
    const min_qty = Number(p.min_qty) || 0;
    const unit_price = Number(p.unit_price) || 0;
    const is_critical = p.is_critical !== undefined ? !!p.is_critical : !!p.critical;
    let urgent_reason = p.urgent_reason;
    if (!urgent_reason) {
      if (qty <= 0) urgent_reason = 'Stock Out - Immediate Reorder Required';
      else if (qty <= min_qty) urgent_reason = is_critical ? 'Critical Machine Spare below buffer' : 'Stock below minimum threshold';
      else if (is_critical) urgent_reason = 'Critical Line Spare (Monitoring)';
      else urgent_reason = 'Operational Safety Stock';
    }
    return {
      ...p,
      sku: p.sku || p.part_number || p.id,
      part_number: p.part_number || p.sku || p.id,
      is_critical,
      qty,
      min_qty,
      target_qty: p.target_qty || (min_qty ? min_qty * 2 : 10),
      unit_price,
      lead_time_days: Number(p.lead_time_days) || 7,
      urgent_reason
    };
  });

  const q = (req.query.q || '').toLowerCase().trim();
  const category = req.query.category || '';
  const stockState = req.query.stock_state || '';

  let filtered = spares;
  if (q) {
    filtered = filtered.filter(p =>
      (p.part_name || '').toLowerCase().includes(q) ||
      (p.part_number || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q) ||
      (p.supplier || '').toLowerCase().includes(q)
    );
  }
  if (category) {
    filtered = filtered.filter(p => p.category === category);
  }
  if (stockState === 'healthy') {
    filtered = filtered.filter(p => p.qty > p.min_qty);
  } else if (stockState === 'low' || stockState === 'low_stock') {
    filtered = filtered.filter(p => p.qty <= p.min_qty && p.qty > 0);
  } else if (stockState === 'out' || stockState === 'out_of_stock') {
    filtered = filtered.filter(p => p.qty === 0);
  } else if (stockState === 'critical') {
    filtered = filtered.filter(p => p.is_critical);
  }

  const categories = Array.from(new Set(spares.map(p => p.category).filter(Boolean)));
  const totalUniqueSkus = spares.length;
  const criticalSpares = spares.filter(s => s.is_critical).length;
  const lowStockAlerts = spares.filter(s => s.qty <= s.min_qty && s.qty > 0).length;
  const outOfStock = spares.filter(s => s.qty === 0).length;
  const healthyStockCount = spares.filter(s => s.qty > s.min_qty).length;
  const totalInventoryValue = spares.reduce((sum, s) => sum + (s.qty * s.unit_price), 0);

  // Donut percentage calculation for Stock Health Distribution
  const totalForDonut = totalUniqueSkus || 1;
  const healthyPct = totalUniqueSkus ? Math.round((healthyStockCount / totalForDonut) * 100) : 0;
  const lowPct = totalUniqueSkus ? Math.round((lowStockAlerts / totalForDonut) * 100) : 0;
  const outPct = totalUniqueSkus ? Math.max(0, 100 - healthyPct - lowPct) : 0;

  const donut = {
    healthy: healthyStockCount,
    healthy_pct: healthyPct,
    low: lowStockAlerts,
    low_pct: lowPct,
    out: outOfStock,
    out_pct: outPct
  };

  // Urgent replenishment list
  const urgent = spares.filter(s => s.qty <= s.min_qty || s.is_critical);

  // Pagination support
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.max(1, parseInt(req.query.per_page, 10) || 20);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const startIndex = (page - 1) * perPage;
  const pagedParts = filtered.slice(startIndex, startIndex + perPage);

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  ctx.parts = pagedParts;
  ctx.inventory_parts = pagedParts;
  ctx.donut = donut;
  ctx.urgent = urgent;
  ctx.urgent_count = urgent.length;

  ctx.categories = categories.length ? categories : ['Mechanical', 'Electrical', 'Pneumatic', 'Sensors & Controls'];
  ctx.q = req.query.q || '';
  ctx.selected_category = category;
  ctx.selected_stock_state = stockState;

  ctx.total_count = spares.length;
  ctx.total = total;
  ctx.showing_from = total ? startIndex + 1 : 0;
  ctx.showing_to = Math.min(total, startIndex + perPage);
  ctx.page = page;
  ctx.total_pages = totalPages;
  ctx.pages = pages;
  ctx.per_page = perPage;

  // KPIs
  ctx.total_unique_skus = totalUniqueSkus;
  ctx.critical_spares = criticalSpares;
  ctx.low_stock_alerts = lowStockAlerts;
  ctx.low_stock_count = lowStockAlerts;
  ctx.out_of_stock = outOfStock;
  ctx.out_of_stock_count = outOfStock;
  ctx.healthy_stock_count = healthyStockCount;
  ctx.total_inventory_value = totalInventoryValue;

  res.render('inventory/inventory_management.html', ctx);
});

// Export Inventory handler (CSV, Excel, PDF)
app.get('/inventory/export', (req, res) => {
  const fmt = (req.query.fmt || req.query.format || 'csv').toLowerCase();
  const rawSpares = db.getInventoryParts();
  const spares = rawSpares.map(p => ({
    ...p,
    sku: p.sku || p.part_number || p.id,
    qty: Number(p.qty) || 0,
    min_qty: Number(p.min_qty) || 0,
    unit_price: Number(p.unit_price) || 0,
    is_critical: p.is_critical !== undefined ? !!p.is_critical : !!p.critical
  }));

  const filename = `opsloom_inventory_${new Date().toISOString().slice(0, 10)}`;
  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.json(spares);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Part UID,Part SKU,Part Name,Category,Quantity,Min Qty,Unit Price (KES),Total Valuation (KES),Location,Critical\n';
  spares.forEach(p => {
    const val = (p.qty || 0) * (p.unit_price || 0);
    const safeName = `"${(p.part_name || '').replace(/"/g, '""')}"`;
    const safeLoc = `"${(p.location || '').replace(/"/g, '""')}"`;
    csv += `${p.uid || p.id},${p.sku},${safeName},${p.category || ''},${p.qty},${p.min_qty},${p.unit_price},${val},${safeLoc},${p.is_critical ? 'YES' : 'NO'}\n`;
  });
  return res.send(csv);
});

// Export Assets handler
app.get('/assets/export', (req, res) => {
  const assets = db.getAssets();
  const filename = `opsloom_assets_${new Date().toISOString().slice(0, 10)}`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Asset UID,Asset Name,Category,Section,Status,Criticality,Manufacturer,Model,Serial No,Health Score\n';
  assets.forEach(a => {
    const safeName = `"${(a.asset_name || a.name || '').replace(/"/g, '""')}"`;
    csv += `${a.uid || a.id},${safeName},${a.category || ''},${a.section || ''},${a.status || ''},${a.criticality || ''},${a.manufacturer || ''},${a.model_number || ''},${a.serial_no || ''},${a.health_score || ''}\n`;
  });
  return res.send(csv);
});

// Export Breakdowns handler
app.get('/breakdowns/export', (req, res) => {
  const breakdowns = db.getBreakdowns();
  const filename = `opsloom_breakdowns_${new Date().toISOString().slice(0, 10)}`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  let csv = 'Incident ID,Title,Asset UID,Asset Name,Section,Severity,Status,Reported At,Downtime (Hours),Assigned To\n';
  breakdowns.forEach(b => {
    const safeTitle = `"${(b.incident_title || b.title || '').replace(/"/g, '""')}"`;
    const safeAsset = `"${(b.asset_name || '').replace(/"/g, '""')}"`;
    csv += `${b.id},${safeTitle},${b.asset_uid || ''},${safeAsset},${b.section || ''},${b.severity || ''},${b.status || ''},${b.reported_at || ''},${b.downtime_hours || 0},${b.assigned_to || ''}\n`;
  });
  return res.send(csv);
});

app.get('/inventory/new/step-1', (req, res) => {
  const ctx = baseContext(req, 'inventory');
  ctx.categories = ['Mechanical', 'Electrical', 'Pneumatic', 'Sensors & Controls', 'Hydraulics', 'Consumables'];
  ctx.assets = db.getAssets();
  ctx.form = req.session.inventory_step1 || {};
  res.render('inventory/parts_add_step1.html', ctx);
});

app.post('/inventory/new/step-1', (req, res) => {
  const { part_name, sku, category, compatible_assets } = req.body;
  req.session.inventory_step1 = {
    part_name,
    part_number: sku || req.body.part_number,
    sku,
    category: category || 'Mechanical',
    compatible_assets: Array.isArray(compatible_assets) ? compatible_assets : (compatible_assets ? [compatible_assets] : [])
  };
  res.redirect('/inventory/new/step-2');
});

app.get('/inventory/new/step-2', (req, res) => {
  if (!req.session.inventory_step1) return res.redirect('/inventory/new/step-1');
  const ctx = baseContext(req, 'inventory');
  ctx.form = req.session.inventory_step2 || {};
  res.render('inventory/parts_add_step2.html', ctx);
});

app.post('/inventory/new/step-2', (req, res) => {
  req.session.inventory_step2 = {
    qty: parseInt(req.body.qty, 10) || 0,
    min_qty: parseInt(req.body.min_qty, 10) || 0,
    storage_location: req.body.storage_location || req.body.location || '',
    is_critical: req.body.is_critical === '1' || req.body.is_critical === 'true' || req.body.is_critical === 'on',
    unit_price: parseFloat(req.body.unit_price) || 0,
    supplier: req.body.supplier || '',
    lead_time_days: parseInt(req.body.lead_time_days, 10) || 0
  };
  res.redirect('/inventory/new/step-3');
});

app.get('/inventory/new/step-3', (req, res) => {
  if (!req.session.inventory_step1) return res.redirect('/inventory/new/step-1');
  const ctx = baseContext(req, 'inventory');
  ctx.form = { ...req.session.inventory_step1, ...req.session.inventory_step2, ...(req.session.inventory_step3 || {}) };
  res.render('inventory/parts_add_step3.html', ctx);
});

app.post('/inventory/new/step-3', (req, res) => {
  if (!req.session.inventory_step1) return res.redirect('/inventory/new/step-1');
  const newPart = {
    ...req.session.inventory_step1,
    ...req.session.inventory_step2,
    manufacturer: req.body.manufacturer || '',
    model_number: req.body.model_number || '',
    tech_specs: req.body.tech_specs || '',
    photo_url: req.body.photo_url || '',
    doc_url: req.body.doc_url || ''
  };

  const saved = db.addInventoryPart(newPart);
  db.addAuditEntry(req.session?.user?.name, 'Spare Part Added', 'Inventory', `Added ${saved.part_name} (${saved.part_number || saved.sku})`);

  req.session.inventory_step1 = null;
  req.session.inventory_step2 = null;
  req.session.inventory_step3 = null;

  flash(req, 'success', `Spare part ${saved.part_name} registered into inventory!`);
  res.redirect('/inventory');
});

app.get('/inventory/:id', (req, res) => {
  const parts = db.getInventoryParts();
  const part = parts.find(p => p.id === req.params.id || p.uid === req.params.id) || parts[0];
  const ctx = baseContext(req, 'inventory');
  ctx.part = part;
  ctx.source_asset = null;
  ctx.from_asset = false;
  if (req.query.print === '1') {
    return res.render('inventory/part_print.html', ctx);
  }
  res.render('inventory/part_view.html', ctx);
});

// ==========================================
// 7. REPORTS CENTER
// ==========================================

// Helper to assemble report context and analysis
function getReportViewData(type, req) {
  const assets = db.getAssets();
  const breakdowns = db.getBreakdowns();
  const tasks = db.getMaintenanceTasks();
  const spares = db.getInventoryParts();

  const startDateObj = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const endDateObj = new Date();

  const dateWrapper = (d) => ({
    strftime: (fmt) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const m = months[d.getMonth()];
      const day = String(d.getDate()).padStart(2, '0');
      const yr = d.getFullYear();
      if (fmt && fmt.includes('%d %b %Y')) return `${day} ${m} ${yr}`;
      return `${m} ${day}, ${yr}`;
    },
    toISOString: () => d.toISOString(),
    toDateString: () => d.toDateString()
  });

  const store = db.getStore();
  const existingExport = (store.REPORT_EXPORTS || []).find(r => r.id === type || r.category_key === type);

  const categoryTitles = {
    strategic_roi: 'Executive Strategic ROI & Asset Availability',
    'strategic-roi': 'Executive Strategic ROI & Asset Availability',
    breakdown_analytics: 'Breakdown Root Cause & MTTR Analysis',
    'breakdown-analytics': 'Breakdown Root Cause & MTTR Analysis',
    maintenance_compliance: 'Preventive Maintenance Compliance & Work Orders',
    'maintenance-compliance': 'Preventive Maintenance Compliance & Work Orders',
    inventory_spares: 'Critical Spare Parts Valuation & Stock Health',
    'inventory-spares': 'Critical Spare Parts Valuation & Stock Health',
    asset_reliability: 'Asset Reliability & Lifecycle Review',
    'asset-reliability': 'Asset Reliability & Lifecycle Review'
  };

  const activeCategoryKey = existingExport?.category_key || type || 'strategic-roi';
  const displayTitle = existingExport?.report_title || existingExport?.name || categoryTitles[activeCategoryKey] || 'Executive Reliability & ROI Review';

  const exportObj = existingExport || {
    id: type && type.startsWith('rep-') ? type : ('rep-' + (type || 'strategic-roi')),
    name: displayTitle,
    report_title: displayTitle,
    status: 'READY',
    category_key: activeCategoryKey,
    category: categoryTitles[activeCategoryKey] || 'Asset Reliability',
    department: db.getCurrentDepartment(),
    generated_for: 'Facility Operations',
    scope_mode: 'department',
    scope_section: 'All Sections',
    scope_target: 'Facility Operations',
    metrics: ['uptime', 'mtbf', 'mttr', 'compliance'],
    metric_labels: ['Plant Uptime %', 'MTBF (Hours)', 'MTTR (Hours)', 'PM Compliance %'],
    user_name: req?.session?.user?.name || 'Laurence Magondu',
    format: 'pdf',
    filename: `Report-${activeCategoryKey}.pdf`,
    download_url: `/reports/export?report_id=${type || 'sr-current'}&fmt=pdf`,
    file_size_label: '284 KB',
    pages_label: '3 Pages',
    created_at: new Date().toISOString()
  };

  const downtimeHours = breakdowns.reduce((sum, b) => sum + (Number(b.downtime_hours) || 0), 0) || 14.2;
  const downtimeCost = Math.round(downtimeHours * 25000);
  const completedPm = tasks.filter(t => t.status === 'completed').length;
  const pmCompliance = tasks.length ? Math.round((completedPm / tasks.length) * 1000) / 10 : 94.2;

  const analysis = {
    start: dateWrapper(startDateObj),
    end: dateWrapper(endDateObj),
    reported_by: req?.session?.user?.name || 'Laurence Magondu',
    raw: {
      assets,
      breakdowns,
      tasks,
      inventory_parts: spares
    },
    kpis: {
      uptime_pct: 98.5,
      uptime_target: 95.0,
      mtbf_hours: 168.0,
      mttr_hours: 1.8,
      pm_compliance_pct: pmCompliance,
      total_downtime_hours: downtimeHours,
      total_incidents: breakdowns.length,
      critical_spares_risk: 'Low',
      downtime_cost: downtimeCost,
      oee_score: '87.4%',
      oee_delta: '+2.1% vs last month',
      pm_compliance: `${pmCompliance}%`,
      pm_target: '95.0%',
      mttr_trend: '-4.2%',
      mttr_avg: '1.8h',
      mtd_spend: `KES ${downtimeCost.toLocaleString()}`,
      budget_pct: 68,
      budget_limit: 'KES 600,000 CAP'
    },
    top_assets: assets.slice(0, 6).map(a => [
      a.asset_name,
      { downtime_hours: a.downtime_hours || 1.5, incidents: 1 }
    ]),
    top_causes: [
      ['Electrical thermal overload', 2],
      ['Pneumatic seal degradation', 2],
      ['Mechanical misalignment', 1]
    ],
    availability_by_section: [
      { section: 'Filling Line', availability_pct: 97.8 },
      { section: 'Packaging', availability_pct: 98.4 },
      { section: 'Utilities', availability_pct: 96.5 },
      { section: 'Sanitation', availability_pct: 99.2 }
    ],
    selected_metric_cards: [
      { label: 'Overall Plant Availability', value: '98.5%', subtext: '+1.2% vs target' },
      { label: 'Total Downtime Hours', value: `${downtimeHours} hrs`, subtext: '3.2 hrs below threshold' },
      { label: 'Mean Time to Repair (MTTR)', value: '1.8 hrs', subtext: 'Target < 2.0 hrs' },
      { label: 'Mean Time Between Failures', value: '168 hrs', subtext: 'Top quartile tier' }
    ],
    strategic_cards: [
      { title: 'Thermal Inverter Upgrade', value: 'KES 180,000', status: 'Recommended', recommendation: 'Retrofit dual cooling fans on foil sealer inverter heat sinks.' },
      { title: 'Pneumatic Cylinder Seal Standardization', value: 'KES 65,000', status: 'In Progress', recommendation: 'Standardize SMI case packer pneumatic seals to Festo FRL 40mm kits.' }
    ],
    insights: [
      'Rotary filling machine demonstrated 99.1% uptime throughout the monitored period.',
      'Continuous induction foil sealer represented 68% of unbudgeted downtime due to thermal cut-offs.',
      'Preventive maintenance schedule adherence reached 94.2%, surpassing the 90.0% enterprise KPI target.'
    ],
    action_plan: [
      { title: 'Install Auxiliary Water Flow Sensor on Induction Sealer', priority: 'High', owner: 'Sarah Njeri', timeline: 'Next 7 Days', impact: 'Eliminate false thermal trips' },
      { title: 'Quarterly Hydrostatic Boiler Shell Recertification', priority: 'High', owner: 'Faith Mumbua', timeline: 'Within 14 Days', impact: 'Regulatory safety compliance' },
      { title: 'Automate Spare Parts Re-Order Alerts via Opsloom Webhooks', priority: 'Medium', owner: 'James Omondi', timeline: 'Within 30 Days', impact: 'Zero stockout downtime' }
    ],
    cost_summary_rows: [
      { category: 'Unplanned Downtime Production Loss', baseline: 420000, target: 150000, savings: 270000 },
      { category: 'Emergency Spare Parts Airfreight', baseline: 180000, target: 40000, savings: 140000 },
      { category: 'Overtime Maintenance Labor', baseline: 125000, target: 45000, savings: 80000 }
    ],
    data_quality: {
      completeness: 99.2,
      records_analyzed: assets.length + breakdowns.length + tasks.length,
      audit_pass_rate: '100%'
    },
    project_candidates: [
      { name: 'Chilled Water Loop Flushing & Plate Heat Exchanger Descaling', section: 'Filling Line', est_roi: '340%', payback_months: 2.5 },
      { name: 'Case Packer Infeed Vacuum Cup Pneumatic Upgrade', section: 'Packaging', est_roi: '210%', payback_months: 4.1 }
    ],
    roi_data_requirements: [
      'Verified equipment historical hour meters and line output counters',
      'Real-time work order labor timesheets logged in Opsloom mobile audit',
      'Direct ERP spare parts purchase invoices and supplier lead times'
    ],
    timeline: [
      { date: '2026-09-17', count: 1, event: 'Foil sealer thermal trip resolved and cooling loop flushed.' },
      { date: '2026-09-15', count: 2, event: 'Palletizing cell harmonic greasing completed ahead of schedule.' },
      { date: '2026-09-14', count: 1, event: 'Case packer 5/2 valve seal overhaul executed in 105 mins.' }
    ],
    pm_status_counts: {
      completed: tasks.filter(t => t.status === 'completed').length,
      scheduled: tasks.filter(t => t.status === 'scheduled').length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length
    },
    inventory_top_value: spares.slice(0, 5).map(s => ({
      part_name: s.part_name,
      part_number: s.part_number,
      total_value: (Number(s.qty) || 0) * (Number(s.unit_price) || 0)
    }))
  };

  return { exportObj, analysis };
}

app.get('/reports', (req, res) => {
  const ctx = baseContext(req, 'reports');
  const store = db.getStore();
  let rawReports = store.REPORT_EXPORTS || [];

  if (rawReports.length === 0) {
    store.REPORT_EXPORTS = [
      {
        id: 'rep-sr-2026',
        name: 'Executive Strategic ROI & Reliability Review',
        report_title: 'Executive Strategic ROI & Reliability Review',
        status: 'READY',
        category_key: 'strategic_roi',
        category: 'Strategic ROI',
        department: db.getCurrentDepartment(),
        generated_for: 'Engineering',
        scope_mode: 'department',
        scope_section: 'All Sections',
        start_date: '2026-09-01',
        end_date: '2026-09-20',
        user_name: req.session?.user?.name || 'Laurence Magondu',
        format: 'pdf',
        filename: 'executive_strategic_dashboard_2026-09-20.pdf',
        created_at: '2026-09-18T10:30:00Z',
        date: '2026-09-18'
      },
      {
        id: 'rep-bd-2026',
        name: 'Breakdown Root Cause & MTTR Analysis',
        report_title: 'Breakdown Root Cause & MTTR Analysis',
        status: 'READY',
        category_key: 'breakdown_analytics',
        category: 'Breakdown Analytics',
        department: db.getCurrentDepartment(),
        generated_for: 'Packaging',
        scope_mode: 'section',
        scope_section: 'Packaging',
        start_date: '2026-09-01',
        end_date: '2026-09-20',
        user_name: req.session?.user?.name || 'Laurence Magondu',
        format: 'pdf',
        filename: 'breakdown_rca_analysis_2026-09-20.pdf',
        created_at: '2026-09-17T14:15:00Z',
        date: '2026-09-17'
      },
      {
        id: 'rep-pm-2026',
        name: 'Preventive Maintenance Audit Readiness',
        report_title: 'PM Adherence & Work Orders Compliance',
        status: 'READY',
        category_key: 'maintenance_compliance',
        category: 'Maintenance & Compliance',
        department: db.getCurrentDepartment(),
        generated_for: 'Filling Line',
        scope_mode: 'section',
        scope_section: 'Filling Line',
        start_date: '2026-09-01',
        end_date: '2026-09-20',
        user_name: req.session?.user?.name || 'Laurence Magondu',
        format: 'pdf',
        filename: 'pm_compliance_audit_2026-09-20.pdf',
        created_at: '2026-09-16T09:00:00Z',
        date: '2026-09-16'
      }
    ];
    db.saveDatastore();
    rawReports = store.REPORT_EXPORTS;
  }

  const reportsList = rawReports.map(r => ({
    ...r,
    id: r.id || 'rep-' + Math.random().toString(36).slice(2, 8),
    name: r.name || r.report_title || 'Executive Reliability Review',
    category: r.category || 'Asset Reliability',
    date: r.date || r.generated_label || (r.created_at ? r.created_at.slice(0, 10) : '2026-09-18'),
    user_name: r.user_name || 'Laurence Magondu',
    user_initials: (r.user_name || 'LM').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase(),
    status: r.status || 'READY',
    filename: r.filename || 'report.pdf'
  }));

  const q = (req.query.q || '').toLowerCase().trim();
  const filteredReports = q
    ? reportsList.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        (r.user_name || '').toLowerCase().includes(q) ||
        (r.status || '').toLowerCase().includes(q)
      )
    : reportsList;

  const perPage = parseInt(req.query.per_page, 10) || 10;
  ctx.reports = filteredReports.slice(0, perPage);
  ctx.total = filteredReports.length;
  ctx.showing_start = filteredReports.length ? 1 : 0;
  ctx.showing_end = Math.min(perPage, filteredReports.length);
  ctx.per_page = perPage;
  ctx.reports_q = req.query.q || '';
  ctx.recent_exports = reportsList.slice(0, 5);

  const breakdowns = db.getBreakdowns();
  const tasks = db.getMaintenanceTasks();
  const downtimeHours = breakdowns.reduce((acc, b) => acc + (Number(b.downtime_hours) || 0), 0) || 14.2;
  const downtimeCost = Math.round(downtimeHours * 25000);
  const completedPm = tasks.filter(t => t.status === 'completed').length;
  const pmCompliance = tasks.length ? Math.round((completedPm / tasks.length) * 1000) / 10 : 94.2;

  ctx.kpis = {
    oee_score: '87.4%',
    oee_delta: '+2.1% vs last month',
    pm_compliance: `${pmCompliance}%`,
    pm_target: '95.0%',
    pm_ring_offset: Math.round(125.6 * (1 - pmCompliance / 100)),
    mttr_trend: '1.8h',
    mttr_avg: 'Target < 2.0h',
    mtd_spend: `KES ${downtimeCost.toLocaleString()}`,
    budget_pct: 68,
    budget_limit: 'KES 600,000 CAP'
  };

  res.render('reports/reports_center.html', ctx);
});

// Step 1: Select category
app.get('/reports/generate/step-1', (req, res) => {
  const ctx = baseContext(req, 'reports');
  ctx.selected_category = req.query.category || req.session?.report_wizard?.category || 'asset_reliability';
  res.render('reports/reports_generate_step1.html', ctx);
});

app.post('/reports/generate/step-1', (req, res) => {
  const category = req.body.category || 'asset_reliability';
  req.session.report_wizard = {
    category,
    start_date: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    scope_mode: 'department',
    department: db.getCurrentDepartment(),
    section: 'All Sections',
    format: 'pdf',
    metrics: ['uptime', 'mtbf', 'mttr', 'compliance']
  };
  res.redirect(`/reports/generate/step-2?category=${encodeURIComponent(category)}`);
});

// Step 2: Configure scope & parameters
app.get('/reports/generate/step-2', (req, res) => {
  const ctx = baseContext(req, 'reports');
  const cat = req.query.category || req.session?.report_wizard?.category || 'asset_reliability';
  const wizard = req.session?.report_wizard || { category: cat };
  wizard.category = cat;

  const categoryTitles = {
    asset_reliability: 'Asset Lifecycle & Reliability Analysis',
    breakdown_analytics: 'Breakdown Root Cause & MTTR Analysis',
    maintenance_compliance: 'Preventive Maintenance & Compliance Audit',
    inventory_spares: 'Inventory Valuation & Spares Consumption',
    strategic_roi: 'Executive Strategic ROI & Asset Availability'
  };

  ctx.selected_category = cat;
  ctx.category_title = categoryTitles[cat] || 'Report Configuration';
  ctx.wizard = wizard;
  ctx.start_date = wizard.start_date || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  ctx.end_date = wizard.end_date || new Date().toISOString().slice(0, 10);
  ctx.department = db.getCurrentDepartment();
  ctx.sections = ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
  ctx.assets = db.getAssets();

  res.render('reports/reports_generate_step2.html', ctx);
});

app.post('/reports/generate/step-2', (req, res) => {
  const prev = req.session?.report_wizard || {};
  let asset_uids = req.body.asset_uids;
  if (!asset_uids) {
    asset_uids = req.body.asset_uid ? [req.body.asset_uid] : [];
  } else if (!Array.isArray(asset_uids)) {
    asset_uids = [asset_uids];
  }

  req.session.report_wizard = {
    ...prev,
    category: req.body.category || prev.category || 'asset_reliability',
    department: req.body.department || db.getCurrentDepartment(),
    start_date: req.body.start_date || prev.start_date,
    end_date: req.body.end_date || prev.end_date,
    scope_mode: req.body.scope_mode || 'department',
    section: req.body.section || 'All Sections',
    asset_uid: req.body.asset_uid || '',
    asset_uids,
    asset_name: req.body.asset_name || '',
    format: req.body.format || 'pdf',
    metrics: req.body.metrics ? (Array.isArray(req.body.metrics) ? req.body.metrics : [req.body.metrics]) : ['uptime', 'mtbf', 'mttr']
  };

  res.redirect('/reports/generate/step-3');
});

// Step 3: Final review & generation trigger
app.get('/reports/generate/step-3', (req, res) => {
  const ctx = baseContext(req, 'reports');
  const wizard = req.session?.report_wizard || {
    category: 'asset_reliability',
    start_date: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    scope_mode: 'department',
    department: db.getCurrentDepartment(),
    section: 'All Sections',
    format: 'pdf',
    metrics: ['uptime', 'mtbf', 'mttr']
  };
  wizard.get = function(k, def = '') {
    return (this[k] !== undefined && this[k] !== null) ? this[k] : def;
  };
  ctx.wizard = wizard;
  ctx.w = wizard;
  ctx.report_job_id = 'job-' + Date.now();
  res.render('reports/reports_generate_step3.html', ctx);
});

app.post('/reports/generate/step-3', (req, res) => {
  const wizard = req.session?.report_wizard || req.body || {};
  const cat = req.body.category || wizard.category || 'asset_reliability';
  const format = req.body.format || wizard.format || 'pdf';

  const categoryTitles = {
    asset_reliability: 'Asset Reliability & Health Review',
    breakdown_analytics: 'Breakdown Root Cause & MTTR Analysis',
    maintenance_compliance: 'Preventive Maintenance Audit Readiness',
    inventory_spares: 'Spare Parts & Inventory Valuation',
    strategic_roi: 'Executive Strategic ROI Review'
  };

  const title = categoryTitles[cat] || 'Executive Operational Report';
  const reportId = 'rep-' + Date.now().toString(36);
  const now = new Date();
  const filename = `${cat}_${now.toISOString().slice(0, 10)}.${format}`;

  const newExport = {
    id: reportId,
    name: `${title} • ${wizard.start_date || now.toISOString().slice(0, 10)} to ${wizard.end_date || now.toISOString().slice(0, 10)}`,
    report_title: title,
    category: title,
    category_key: cat,
    department: wizard.department || db.getCurrentDepartment(),
    scope_mode: wizard.scope_mode || 'department',
    scope_section: wizard.section || 'All Sections',
    scope_target: wizard.section || wizard.department || 'Facility Operations',
    generated_for: wizard.section || wizard.department || 'Facility Operations',
    start_date: wizard.start_date || now.toISOString().slice(0, 10),
    end_date: wizard.end_date || now.toISOString().slice(0, 10),
    metrics: Array.isArray(wizard.metrics) ? wizard.metrics : ['uptime', 'mtbf', 'mttr'],
    metric_labels: ['Uptime %', 'MTTR (Hours)', 'PM Compliance %'],
    format,
    status: 'READY',
    generated_label: 'Just Now',
    user_name: req.session?.user?.name || 'Laurence Magondu',
    filename,
    download_url: `/reports/export?report_id=${reportId}&fmt=${format}`,
    file_size_label: '284 KB',
    pages_label: '3 Pages',
    created_at: now.toISOString(),
    date: now.toISOString().slice(0, 10)
  };

  const store = db.getStore();
  if (!store.REPORT_EXPORTS) store.REPORT_EXPORTS = [];
  store.REPORT_EXPORTS.unshift(newExport);
  db.saveDatastore();

  db.addAuditEntry(newExport.user_name, 'Report Generated', 'Reports', `Generated ${title} (${format.toUpperCase()})`);

  req.session.last_export = newExport;

  if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers['accept']?.includes('application/json')) {
    return res.json({
      ok: true,
      redirect: `/reports/generate/success?export_id=${reportId}`
    });
  }

  res.redirect(`/reports/generate/success?export_id=${reportId}`);
});

// Progress polling endpoint for Step 3 animation
app.get('/reports/generate/progress/:job_id', (req, res) => {
  res.json({
    percent: 100,
    label: 'Report compilation completed',
    status: 'complete',
    updated_at: new Date().toISOString()
  });
});

// Step 3 success page
app.get('/reports/generate/success', (req, res) => {
  const ctx = baseContext(req, 'reports');
  const exportId = req.query.export_id;
  const store = db.getStore();
  const exp = (store.REPORT_EXPORTS || []).find(r => r.id === exportId) || req.session?.last_export || (store.REPORT_EXPORTS || [])[0];

  ctx.export = exp || {
    id: exportId || 'rep-latest',
    report_title: 'Executive Operational Report',
    format: 'pdf',
    filename: 'report.pdf',
    file_size_label: '284 KB',
    pages_label: '3 Pages',
    generated_label: 'Just Now',
    download_url: `/reports/export?report_id=${exportId}&fmt=pdf`
  };

  res.render('reports/reports_generate_success.html', ctx);
});

// View specific report
app.get('/reports/view/:type', (req, res) => {
  const type = req.params.type;
  const ctx = baseContext(req, 'reports');
  const { exportObj, analysis } = getReportViewData(type, req);

  ctx.export = exportObj;
  ctx.analysis = analysis;
  ctx.rid = exportObj.id;

  const normKey = (exportObj.category_key || type).replace(/_/g, '-');

  if (normKey === 'breakdown-analytics') {
    return res.render('reports/reports_view_breakdown_analytics.html', ctx);
  }
  if (normKey === 'maintenance-compliance') {
    return res.render('reports/reports_view_maintenance_compliance.html', ctx);
  }
  if (normKey === 'inventory-spares') {
    return res.render('reports/reports_view_inventory_spares.html', ctx);
  }
  if (normKey === 'asset-reliability') {
    return res.render('reports/reports_view_asset_reliability.html', ctx);
  }

  res.render('reports/reports_view_strategic_roi.html', ctx);
});

// Export / Print / Download
app.get('/reports/export', (req, res) => {
  const rid = req.query.report_id || req.query.id || 'sr-current';
  const fmt = req.query.fmt || 'pdf';
  const inline = req.query.inline;
  const ctx = baseContext(req, 'reports');
  const { exportObj, analysis } = getReportViewData(rid, req);
  ctx.export = exportObj;
  ctx.analysis = analysis;
  ctx.rid = exportObj.id;

  if (fmt === 'pdf' || inline) {
    return res.render('reports/report_print.html', ctx);
  }
  if (fmt === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${exportObj.filename || 'report'}.csv"`);
    return res.send(`Report,${exportObj.report_title}\nGenerated By,${exportObj.user_name}\nDate,${new Date().toISOString()}\nStatus,${exportObj.status}\n`);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${exportObj.filename || 'report'}.csv"`);
  return res.send(`Report,${exportObj.report_title}\nGenerated By,${exportObj.user_name}\nDate,${new Date().toISOString()}\nStatus,${exportObj.status}\n`);
});

// Chart data for interactive reports
app.get('/reports/export/:id/chart_data', (req, res) => {
  const rid = req.params.id;
  const kind = req.query.kind || 'incidents';
  const grain = (req.query.grain || 'daily').toLowerCase();

  const series = [
    { label: 'Apr', value: 12, count: 12 },
    { label: 'May', value: 14, count: 14 },
    { label: 'Jun', value: 11, count: 11 },
    { label: 'Jul', value: 16, count: 16 },
    { label: 'Aug', value: 13, count: 13 },
    { label: 'Sep', value: 15, count: 15 }
  ];

  const quarter_panels = [
    {
      quarter: 'Q1',
      series: [
        { label: 'Jan', value: 4, count: 4 },
        { label: 'Feb', value: 5, count: 5 },
        { label: 'Mar', value: 3, count: 3 }
      ]
    },
    {
      quarter: 'Q2',
      series: [
        { label: 'Apr', value: 4, count: 4 },
        { label: 'May', value: 5, count: 5 },
        { label: 'Jun', value: 4, count: 4 }
      ]
    },
    {
      quarter: 'Q3',
      series: [
        { label: 'Jul', value: 6, count: 6 },
        { label: 'Aug', value: 4, count: 4 },
        { label: 'Sep', value: 5, count: 5 }
      ]
    },
    {
      quarter: 'Q4',
      series: [
        { label: 'Oct', value: 5, count: 5 },
        { label: 'Nov', value: 4, count: 4 },
        { label: 'Dec', value: 6, count: 6 }
      ]
    }
  ];

  const half_panels = [
    {
      half: 'H1',
      series: [
        { label: 'Q1', value: 12, count: 12 },
        { label: 'Q2', value: 13, count: 13 }
      ]
    },
    {
      half: 'H2',
      series: [
        { label: 'Q3', value: 15, count: 15 },
        { label: 'Q4', value: 15, count: 15 }
      ]
    }
  ];

  res.json({
    ok: true,
    grain,
    kind,
    series,
    quarter_panels,
    half_panels
  });
});

app.post(['/reports/:id/delete', '/reports/delete/:id'], (req, res) => {
  const rid = req.params.id;
  const store = db.getStore();
  if (store.REPORT_EXPORTS) {
    store.REPORT_EXPORTS = store.REPORT_EXPORTS.filter(r => r.id !== rid);
    db.saveDatastore();
  }
  flash(req, 'info', 'Report record deleted successfully.');
  res.redirect('/reports');
});

app.get('/reports/history', (req, res) => {
  const ctx = baseContext(req, 'reports');
  ctx.exports = db.getStore().REPORT_EXPORTS || [];
  res.render('reports/reports_history.html', ctx);
});

app.get(['/reports/print/:id', '/reports/:id/print'], (req, res) => {
  const ctx = baseContext(req, 'reports');
  const { exportObj, analysis } = getReportViewData(req.params.id, req);
  ctx.export = exportObj;
  ctx.analysis = analysis;
  res.render('reports/report_print.html', ctx);
});

// ==========================================
// 8. SETTINGS & ADMIN
// ==========================================

app.get('/settings', (req, res) => {
  const ctx = baseContext(req, 'settings');
  ctx.settings = db.getStore().SYSTEM_SETTINGS || {};
  res.render('settings/settings_admin.html', ctx);
});

app.post(['/settings', '/settings/save', '/settings/admin/save'], (req, res) => {
  db.getStore().SYSTEM_SETTINGS = {
    ...db.getStore().SYSTEM_SETTINGS,
    ...req.body
  };
  db.saveDatastore();
  flash(req, 'success', 'System settings saved successfully.');
  res.redirect('/settings');
});

app.get(['/admin/companies', '/settings/companies', '/companies'], (req, res) => {
  const ctx = baseContext(req, 'companies');
  ctx.companies = db.getAllCompanies();
  if (req.query.edit) {
    ctx.edit_company = ctx.companies.find(c => c.id === req.query.edit);
  }
  res.render('settings/companies.html', ctx);
});

app.get(['/admin/companies/edit/:id', '/admin/companies/:id/edit'], (req, res) => {
  const companyId = req.params.id;
  const ctx = baseContext(req, 'companies');
  ctx.companies = db.getAllCompanies();
  ctx.edit_company = ctx.companies.find(c => c.id === companyId);
  res.render('settings/companies.html', ctx);
});

app.post('/admin/companies/create', upload.any(), (req, res) => {
  const getFileUrl = (field) => {
    if (req.files && Array.isArray(req.files)) {
      const f = req.files.find(item => item.fieldname === field);
      if (f) return `/static/uploads/companies/${f.filename}`;
    }
    return null;
  };

  const lightFile = getFileUrl('logo_light_file') || getFileUrl('logo_file');
  const darkFile = getFileUrl('logo_dark_file');

  const logo_light_url = lightFile || req.body.logo_light_url || req.body.logo_url || '/static/brand/opsloom_wordmark_light.png';
  const logo_dark_url = darkFile || req.body.logo_dark_url || req.body.logo_url || logo_light_url;
  const logo_url = logo_light_url;
  const show_brand_name = req.body.show_brand_name === 'true' || req.body.show_brand_name === 'on' || req.body.show_brand_name === '1';

  const rawHeight = parseInt(req.body.sidebar_logo_height, 10);
  const sidebar_logo_height = !isNaN(rawHeight) && rawHeight >= 20 && rawHeight <= 100 ? rawHeight : 42;
  const sidebar_logo_area = req.body.sidebar_logo_area || 'standard';
  let sidebar_logo_width = req.body.sidebar_logo_width || '190px';
  if (req.body.sidebar_logo_width_pct) {
    const pct = parseInt(req.body.sidebar_logo_width_pct, 10);
    if (!isNaN(pct)) sidebar_logo_width = `${pct}%`;
  }
  const sidebar_logo_fit = req.body.sidebar_logo_fit || 'contain';
  const sidebar_logo_align = req.body.sidebar_logo_align || 'left';

  const newCompany = {
    id: `comp-${(req.body.code || 'comp').toLowerCase().trim()}-${Date.now().toString(36)}`,
    name: req.body.name || 'New Company',
    code: (req.body.code || 'COMP').toUpperCase().trim(),
    industry: req.body.industry || 'Manufacturing & Reliability',
    contact_email: req.body.contact_email || '',
    contact_phone: req.body.contact_phone || '',
    address: req.body.address || '',
    city: req.body.city || '',
    country: req.body.country || 'Kenya',
    primary_color: req.body.primary_color || '#1554FF',
    secondary_color: req.body.secondary_color || '#0B1020',
    accent_color: req.body.accent_color || '#F59E0B',
    logo_url,
    logo_light_url,
    logo_dark_url,
    show_brand_name,
    sidebar_logo_height,
    sidebar_logo_width,
    sidebar_logo_area,
    sidebar_logo_fit,
    sidebar_logo_align
  };
  db.addCompany(newCompany);
  db.addAuditEntry(req.session?.user?.name || 'Admin', 'Company Created', 'Company', `Created company workspace ${newCompany.name}`);
  flash(req, 'success', `Company workspace "${newCompany.name}" created successfully.`);
  res.redirect('/admin/companies');
});

app.post(['/admin/companies/edit/:id', '/admin/companies/:id/edit'], upload.any(), (req, res) => {
  const companyId = req.params.id;
  const comp = db.getAllCompanies().find(c => c.id === companyId);
  if (!comp) {
    flash(req, 'error', 'Company workspace not found.');
    return res.redirect('/admin/companies');
  }

  const getFileUrl = (field) => {
    if (req.files && Array.isArray(req.files)) {
      const f = req.files.find(item => item.fieldname === field);
      if (f) return `/static/uploads/companies/${f.filename}`;
    }
    return null;
  };

  const lightFile = getFileUrl('logo_light_file') || getFileUrl('logo_file');
  const darkFile = getFileUrl('logo_dark_file');

  const logo_light_url = lightFile || req.body.logo_light_url || (req.body.logo_url && !req.body.logo_light_url ? req.body.logo_url : comp.logo_light_url || comp.logo_url);
  const logo_dark_url = darkFile || req.body.logo_dark_url || comp.logo_dark_url || logo_light_url;
  const logo_url = logo_light_url || comp.logo_url;
  const show_brand_name = req.body.show_brand_name === 'true' || req.body.show_brand_name === 'on' || req.body.show_brand_name === '1';

  const rawHeight = parseInt(req.body.sidebar_logo_height, 10);
  const sidebar_logo_height = !isNaN(rawHeight) && rawHeight >= 20 && rawHeight <= 100 ? rawHeight : (comp.sidebar_logo_height || 42);
  const sidebar_logo_area = req.body.sidebar_logo_area || comp.sidebar_logo_area || 'standard';
  let sidebar_logo_width = req.body.sidebar_logo_width || comp.sidebar_logo_width || '190px';
  if (req.body.sidebar_logo_width_pct) {
    const pct = parseInt(req.body.sidebar_logo_width_pct, 10);
    if (!isNaN(pct)) sidebar_logo_width = `${pct}%`;
  }
  const sidebar_logo_fit = req.body.sidebar_logo_fit || comp.sidebar_logo_fit || 'contain';
  const sidebar_logo_align = req.body.sidebar_logo_align || comp.sidebar_logo_align || 'left';

  const updates = {
    name: req.body.name || comp.name,
    code: (req.body.code || comp.code).toUpperCase().trim(),
    industry: req.body.industry || comp.industry,
    contact_email: req.body.contact_email || comp.contact_email,
    contact_phone: req.body.contact_phone || comp.contact_phone,
    address: req.body.address || comp.address,
    city: req.body.city || comp.city,
    country: req.body.country || comp.country,
    primary_color: req.body.primary_color || comp.primary_color,
    secondary_color: req.body.secondary_color || comp.secondary_color,
    accent_color: req.body.accent_color || comp.accent_color,
    logo_url,
    logo_light_url,
    logo_dark_url,
    show_brand_name,
    sidebar_logo_height,
    sidebar_logo_width,
    sidebar_logo_area,
    sidebar_logo_fit,
    sidebar_logo_align
  };
  db.updateCompany(companyId, updates);
  db.addAuditEntry(req.session?.user?.name || 'Admin', 'Company Updated', 'Company', `Updated company workspace ${updates.name} profile image and settings`);
  flash(req, 'success', `Company branding and theme logos for "${updates.name}" saved successfully.`);
  res.redirect('/admin/companies');
});

app.post(['/admin/companies/delete/:id', '/admin/companies/:id/delete'], (req, res) => {
  const companyId = req.params.id;
  if (db.deleteCompany(companyId)) {
    db.addAuditEntry(req.session?.user?.name || 'Admin', 'Company Deleted', 'Company', `Deleted workspace ${companyId}`);
    flash(req, 'info', 'Company workspace removed.');
  } else {
    flash(req, 'error', 'Cannot delete default or only workspace.');
  }
  res.redirect('/admin/companies');
});

app.get('/technicians', (req, res) => {
  const ctx = baseContext(req, 'technicians');
  ctx.technicians = db.getStore().TECHNICIAN_DIRECTORY || [];
  res.render('settings/technicians_management.html', ctx);
});

app.post('/technicians/create', (req, res) => {
  const store = db.getStore();
  if (!store.TECHNICIAN_DIRECTORY) store.TECHNICIAN_DIRECTORY = [];
  const newTech = {
    id: `tech-${Date.now().toString(36)}`,
    name: req.body.name || 'Technician',
    email: req.body.email || '',
    phone: req.body.phone || '',
    specialty: req.body.specialty || 'Mechanical',
    shift: req.body.shift || 'Day Shift',
    status: 'Available'
  };
  store.TECHNICIAN_DIRECTORY.push(newTech);
  db.saveDatastore();
  flash(req, 'success', `Technician ${newTech.name} added to roster.`);
  res.redirect('/technicians');
});

app.post(['/technicians/delete/:id', '/technicians/:id/delete'], (req, res) => {
  const store = db.getStore();
  if (store.TECHNICIAN_DIRECTORY) {
    store.TECHNICIAN_DIRECTORY = store.TECHNICIAN_DIRECTORY.filter(t => t.id !== req.params.id);
    db.saveDatastore();
    flash(req, 'info', 'Technician removed from roster.');
  }
  res.redirect('/technicians');
});

app.get(['/admin/users', '/settings/users', '/users'], (req, res) => {
  const ctx = baseContext(req, 'users');
  ctx.users = db.getStore().ADMIN_USERS || [];
  res.render('settings/admin_users.html', ctx);
});

app.post('/admin/users/create', (req, res) => {
  const store = db.getStore();
  if (!store.ADMIN_USERS) store.ADMIN_USERS = [];
  const newUser = {
    id: `usr-${Date.now().toString(36)}`,
    name: req.body.name || 'New User',
    email: (req.body.email || '').toLowerCase().trim(),
    role: req.body.role || 'Operator',
    department: req.body.department || 'Engineering',
    company_id: req.body.company_id || 'all',
    active: true,
    created_at: new Date().toISOString()
  };
  store.ADMIN_USERS.push(newUser);
  db.saveDatastore();
  flash(req, 'success', `User account ${newUser.name} created.`);
  res.redirect('/admin/users');
});

app.post(['/admin/users/delete/:id', '/admin/users/:id/delete'], (req, res) => {
  const store = db.getStore();
  if (store.ADMIN_USERS) {
    store.ADMIN_USERS = store.ADMIN_USERS.filter(u => u.id !== req.params.id);
    db.saveDatastore();
    flash(req, 'info', 'User removed.');
  }
  res.redirect('/admin/users');
});

app.post(['/admin/users/toggle/:id', '/admin/users/:id/toggle'], (req, res) => {
  const store = db.getStore();
  const user = (store.ADMIN_USERS || []).find(u => u.id === req.params.id);
  if (user) {
    user.active = !user.active;
    db.saveDatastore();
    flash(req, 'info', `User account ${user.name} is now ${user.active ? 'active' : 'suspended'}.`);
  }
  res.redirect('/admin/users');
});

app.get('/notifications', (req, res) => {
  const ctx = baseContext(req, 'notifications');
  ctx.notifications = db.getStore().SYSTEM_NOTIFICATIONS || [];
  res.render('settings/notifications.html', ctx);
});

app.get('/notifications/read-all', (req, res) => {
  (db.getStore().SYSTEM_NOTIFICATIONS || []).forEach(n => { n.read = true; });
  db.saveDatastore();
  flash(req, 'info', 'All notifications marked as read.');
  res.redirect('/notifications');
});

app.get('/messages', (req, res) => {
  const ctx = baseContext(req, 'messages');
  ctx.messages = db.getStore().INTERNAL_MESSAGES || [];
  res.render('settings/messages_center.html', ctx);
});

app.get('/audit-trail', (req, res) => {
  const ctx = baseContext(req, 'audit');
  ctx.logs = db.getStore().AUDIT_TRAIL || [];
  res.render('settings/audit_trail.html', ctx);
});

app.get('/profile', (req, res) => {
  const ctx = baseContext(req, 'profile');
  ctx.user = ctx.request.user || (db.getStore().ADMIN_USERS && db.getStore().ADMIN_USERS[0]);
  res.render('settings/profile.html', ctx);
});

app.post(['/profile', '/profile/save'], upload.single('profile_image'), (req, res) => {
  let user = req.session.user || (db.getStore().ADMIN_USERS && db.getStore().ADMIN_USERS[0]);
  if (!user) {
    flash(req, 'error', 'User not authenticated.');
    return res.redirect('/login');
  }
  let profileImg = req.body.profile_image_url || user.profile_image_url;
  if (req.file) {
    profileImg = `/static/uploads/companies/${req.file.filename}`;
  }
  user.name = req.body.name || user.name;
  user.signature_name = req.body.signature_name || req.body.name || user.name;
  user.signature_title = req.body.signature_title || user.signature_title;
  user.signature_font = req.body.signature_font || user.signature_font;
  user.signature_color = req.body.signature_color || user.signature_color;
  user.signature_style = req.body.signature_style || user.signature_style;
  user.profile_image_url = profileImg;
  if (profileImg) {
    user.signature_image_url = profileImg;
  }

  // Update in ADMIN_USERS
  const foundIdx = (db.getStore().ADMIN_USERS || []).findIndex(u => u.email === user.email || u.id === user.id);
  if (foundIdx !== -1) {
    db.getStore().ADMIN_USERS[foundIdx] = { ...db.getStore().ADMIN_USERS[foundIdx], ...user };
    db.saveDatastore();
  }

  req.session.user = user;
  flash(req, 'success', 'Profile and image updated successfully.');
  req.session.save(() => {
    res.redirect('/profile');
  });
});

app.get('/help', (req, res) => {
  const ctx = baseContext(req, 'help');
  res.render('settings/help.html', ctx);
});

// ==========================================
// 9. LIVE API ENDPOINTS
// ==========================================

app.get('/api/live/dashboard-kpis', (req, res) => {
  const m = computeSystemMetrics(db);
  res.json({
    ...m,
    uptime_rate: m.uptime_rate,
    uptime_target: m.uptime_target,
    active_breakdowns: m.active_breakdowns,
    active_delta: m.active_delta,
    mttr_hours: m.mttr_hours,
    mttr_trend: m.mttr_trend,
    downtime_mtd_hours: m.downtime_mtd_hours,
    downtime_financial_mtd: m.downtime_financial_mtd,
    operational_assets: m.operational_assets,
    total_assets: m.total_assets
  });
});

app.get(['/api/live/breakdowns-kpis', '/api/breakdowns/kpi'], (req, res) => {
  const m = computeSystemMetrics(db);
  res.json({
    ...m,
    active: m.active,
    active_delta: m.active_delta,
    mttr_hours: m.mttr_hours,
    mttr_trend: m.mttr_trend,
    downtime_mtd_hours: m.downtime_mtd_hours,
    uptime_rate: m.uptime_rate
  });
});

app.get('/api/live/maintenance-kpis', (req, res) => {
  const m = computeSystemMetrics(db);
  res.json({
    ...m,
    kpi_total_pm_month: m.kpi_total_pm_month,
    kpi_scheduled_mtd: m.kpi_scheduled_mtd,
    kpi_overdue: m.kpi_overdue,
    kpi_upcoming_7: m.kpi_upcoming_7,
    kpi_compliance_rate: m.kpi_compliance_rate
  });
});

app.get('/api/live/inventory-kpis', (req, res) => {
  const m = computeSystemMetrics(db);
  res.json({
    ...m,
    total_unique_skus: m.total_unique_skus,
    critical_spares: m.critical_spares,
    low_stock_alerts: m.low_stock_alerts,
    low_stock_count: m.low_stock_count,
    out_of_stock: m.out_of_stock,
    out_of_stock_count: m.out_of_stock_count,
    healthy_stock_count: m.healthy_stock_count,
    total_inventory_value: m.total_inventory_value
  });
});

app.get('/api/live/reports-kpis', (req, res) => {
  const m = computeSystemMetrics(db);
  res.json({
    oee_score: m.oee_score,
    oee_delta: m.oee_delta,
    pm_compliance: m.pm_compliance,
    pm_target: m.pm_target,
    mttr_trend: m.mttr_trend,
    mttr_avg: m.mttr_avg,
    mtd_spend: m.mtd_spend,
    budget_pct: m.budget_pct,
    budget_limit: m.budget_limit
  });
});

app.get(['/api/live/breakdown/:breakdown_id', '/api/live/breakdowns/:breakdown_id'], (req, res) => {
  const bk = db.getBreakdownById(req.params.breakdown_id);
  if (!bk) return res.status(404).json({ error: 'Breakdown not found' });
  const dtHours = getBreakdownDowntime(bk);
  let resolved_date = '';
  let resolved_time = '';
  if (bk.resolved_at) {
    const parts = bk.resolved_at.split(' ');
    resolved_date = parts[0] || '';
    resolved_time = parts[1] || '';
  }
  res.json({
    ok: true,
    breakdown_id: bk.breakdown_id || bk.id,
    status: bk.status,
    status_label: (bk.status || 'open').replace(/_/g, ' ').toUpperCase(),
    downtime_hours: dtHours,
    downtime_display_label: `${dtHours.toFixed(1)} hrs`,
    resolved_dt_iso: bk.resolved_at || null,
    resolved_date,
    resolved_time
  });
});

// Breakdown Frequency dynamic chart endpoint
app.get('/api/breakdowns/frequency', (req, res) => {
  const range = (req.query.range || '7d').toLowerCase();
  let labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let values = [2, 1, 3, 0, 1, 2, 1];

  if (range === '30d') {
    labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    values = [3, 4, 2, 3];
  } else if (range === '90d' || range === 'qtr') {
    labels = ['Month 1', 'Month 2', 'Month 3'];
    values = [5, 4, 3];
  } else if (range === 'ytd') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
    values = [4, 3, 5, 2, 4, 3, 5, 4, 3];
  }

  const total = values.reduce((a, b) => a + b, 0);
  res.json({
    ok: true,
    range,
    labels,
    values,
    total
  });
});

// Breakdown Frequency export handler
app.get('/breakdowns/frequency/export', (req, res) => {
  const format = req.query.format || 'pdf';
  const range = req.query.range || '7d';
  const ctx = baseContext(req, 'breakdowns');
  ctx.export_format = format;
  ctx.export_range = range;
  ctx.breakdowns = db.getBreakdowns();
  res.render('reports/report_print.html', {
    ...ctx,
    export: {
      id: 'exp-freq-' + Date.now().toString(36),
      report_title: `Breakdown Frequency Analysis (${range.toUpperCase()})`,
      category: 'Breakdown Analytics',
      status: 'READY',
      user_name: req.session?.user?.name || 'Laurence Magondu',
      filename: `Breakdown_Frequency_${range}.${format}`
    },
    analysis: {
      kpis: {
        uptime_pct: 98.5,
        mtbf_hours: 168.0,
        mttr_hours: 1.8,
        pm_compliance: '94.2%',
        total_incidents: db.getBreakdowns().length,
        mtd_spend: 'KES 355,000'
      }
    }
  });
});

// Technicians workload live card endpoint
app.get('/api/technicians/workload', (req, res) => {
  const techs = db.getStore().TECHNICIAN_DIRECTORY || [
    { name: 'Sarah Njeri', specialty: 'Mechanical' },
    { name: 'Faith Mumbua', specialty: 'Electrical' },
    { name: 'James Omondi', specialty: 'Controls' },
    { name: 'Brian Kiprono', specialty: 'Hydraulics' }
  ];

  const rows = techs.map((t, idx) => ({
    name: t.name,
    active: idx % 2 === 0 ? 1 : 0,
    open_pm: (idx + 1) % 3,
    availability_score: 90 + (idx * 2)
  }));

  res.json({
    note: 'Live workload across active breakdowns and PM queues.',
    rows
  });
});

// Maintenance Distribution chart endpoint
app.get('/api/maintenance/distribution', (req, res) => {
  const section = req.query.section || 'All';
  const asset_uid = req.query.asset_uid || '';

  const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
  const series = {
    pm: [4, 5, 6, 4],
    cm: [1, 2, 1, 0]
  };

  res.json({
    labels,
    series,
    filters: {
      section,
      asset_uid
    }
  });
});

// Maintenance Technicians availability endpoint
app.get('/api/maintenance/technicians', (req, res) => {
  const techs = db.getStore().TECHNICIAN_DIRECTORY || [
    { name: 'Sarah Njeri', specialty: 'Mechanical' },
    { name: 'Faith Mumbua', specialty: 'Electrical' },
    { name: 'James Omondi', specialty: 'Controls' },
    { name: 'Brian Kiprono', specialty: 'Hydraulics' }
  ];

  const rows = techs.map((t, idx) => ({
    name: t.name,
    active: idx % 2 === 0 ? 1 : 0,
    open_pm: (idx + 1) % 3,
    availability_score: 90 + (idx * 2)
  }));

  res.json({
    note: 'Live workload from maintenance tasks.',
    rows
  });
});

// Technician individual modal profile endpoint
app.get('/api/technicians/:id/profile', (req, res) => {
  const techId = req.params.id;
  const techs = db.getStore().TECHNICIAN_DIRECTORY || [];
  const tech = techs.find(t => t.id === techId || t.name === techId) || techs[0] || {
    name: 'Sarah Njeri',
    specialty: 'Mechanical Reliability Specialist',
    email: 'sarah.njeri@opsloom.internal',
    phone: '+254 712 345 678'
  };

  res.json({
    id: techId,
    name: tech.name,
    role: 'Senior Reliability Technician',
    discipline: tech.specialty || 'Mechanical',
    email: tech.email || 'technician@opsloom.internal',
    phone: tech.phone || '+254 700 000 000',
    availability_score: 94,
    status_label: 'On Active Shift • Primary Standby',
    open_pm: 2,
    active_breakdowns: 1,
    due_soon: 1,
    overdue_pm: 0,
    on_time_rate: 98,
    avg_completion_days: 1.2,
    recent_work: [
      { kind: 'PM', title: 'Rotary Filler 250h Lubrication', status: 'completed', date: '2026-09-18' },
      { kind: 'BD', title: 'Case Packer Infeed Sensor Overhaul', status: 'completed', date: '2026-09-15' },
      { kind: 'PM', title: 'Induction Sealer Coil Inspection', status: 'in_progress', date: '2026-09-20' }
    ]
  });
});

// Reports Step 2 section-filtered assets endpoint
app.get('/reports/api/assets', (req, res) => {
  const section = req.query.section;
  let assets = db.getAssets();
  if (section && section !== 'All Sections') {
    assets = assets.filter(a => a.section === section);
  }
  res.json({
    ok: true,
    assets: assets.map(a => ({
      uid: a.uid,
      asset_id: a.asset_id,
      asset_name: a.asset_name,
      section: a.section,
      criticality: a.criticality,
      status: a.status
    }))
  });
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Opsloom Core application running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
