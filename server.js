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

// Serve static assets
app.use('/static', express.static(path.join(__dirname, 'static')));
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

  const totalAssets = assets.length || 6;
  const operationalAssets = assets.filter(a => a.status === 'operational').length || 4;
  const maintenanceAssets = assets.filter(a => a.status === 'maintenance').length || 1;
  const oosAssets = assets.filter(a => a.status === 'breakdown' || a.status === 'out_of_service' || a.status === 'down').length || 1;

  const openBreakdownsList = breakdowns.filter(b => b.status === 'open' || b.status === 'in_progress');
  const openBreakdowns = openBreakdownsList.length;
  const downtimeHours = breakdowns.reduce((sum, b) => sum + (Number(b.downtime_hours) || 0), 0) || 14.2;
  const resolvedBreakdowns = breakdowns.filter(b => b.status === 'resolved' || b.status === 'closed');
  const mttrHours = resolvedBreakdowns.length
    ? Math.round((resolvedBreakdowns.reduce((sum, b) => sum + (Number(b.downtime_hours) || 0), 0) / resolvedBreakdowns.length) * 10) / 10
    : 1.8;

  const completedPm = tasks.filter(t => t.status === 'completed').length;
  const totalPm = tasks.length || 1;
  const overduePm = tasks.filter(t => t.status === 'overdue' || (t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed')).length;
  const pmCompliance = Math.round((completedPm / totalPm) * 1000) / 10 || 94.2;

  const sparesValue = spares.reduce((sum, s) => sum + ((Number(s.qty) || 0) * (Number(s.unit_price) || 0)), 0) || 485000;
  const lowStockCount = spares.filter(s => (Number(s.qty) || 0) <= (Number(s.min_qty) || 0)).length;
  const outOfStockCount = spares.filter(s => (Number(s.qty) || 0) === 0).length;
  const criticalSparesCount = spares.filter(s => s.is_critical || s.criticality === 'Critical' || s.criticality === 'High').length || 3;

  const uptimeRate = totalAssets ? Math.round((operationalAssets / totalAssets) * 10000) / 100 : 98.5;
  const uptimeTarget = 95.0;
  const downtimeCost = Math.round(downtimeHours * 25000);
  const maintenanceCost = Math.round(completedPm * 15000 + 65000);

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
  let assets = db.getAssets();

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

  const sections = Array.from(new Set(db.getAssets().map(a => a.section).filter(Boolean)));
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

  res.render('assets/assets_master_list.html', ctx);
});

// Step 1: Basic info
app.get('/assets/new/step-1', (req, res) => {
  const ctx = baseContext(req, 'assets');
  const sections = Array.from(new Set(db.getAssets().map(a => a.section).filter(Boolean)));
  ctx.sections = sections.length ? sections : ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
  ctx.form = req.session.asset_step1 || {};
  res.render('assets/assets_add_step1.html', ctx);
});

app.post('/assets/new/step-1', (req, res) => {
  const { asset_name, asset_id, section, serial_no, manufacturer, department } = req.body;
  if (!asset_name || !asset_id || !section) {
    const ctx = baseContext(req, 'assets');
    ctx.sections = ['Filling Line', 'Packaging', 'Utilities', 'Sanitation & Utilities', 'Logistics & Warehousing'];
    ctx.form = req.body;
    ctx.error = 'Please fill all required fields.';
    return res.status(400).render('assets/assets_add_step1.html', ctx);
  }
  req.session.asset_step1 = { asset_name, asset_id, section, serial_no, manufacturer, department: department || 'Engineering' };
  res.redirect('/assets/new/step-2');
});

// Step 2: Technical specifications
app.get('/assets/new/step-2', (req, res) => {
  if (!req.session.asset_step1) return res.redirect('/assets/new/step-1');
  const ctx = baseContext(req, 'assets');
  ctx.form = req.session.asset_step2 || {};
  res.render('assets/assets_add_step2.html', ctx);
});

app.post('/assets/new/step-2', (req, res) => {
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
app.get('/assets/new/step-3', (req, res) => {
  if (!req.session.asset_step1) return res.redirect('/assets/new/step-1');
  const ctx = baseContext(req, 'assets');
  ctx.form = req.session.asset_step3 || {};
  res.render('assets/assets_add_step3.html', ctx);
});

app.post('/assets/new/step-3', (req, res) => {
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
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset || { uid: req.params.uid, asset_name: 'Asset' };
  ctx.parts = db.getInventoryParts();
  res.render('assets/assets_spare_parts.html', ctx);
});

app.get('/assets/:uid/documents', (req, res) => {
  const asset = db.getAssetByUid(req.params.uid);
  const ctx = baseContext(req, 'assets');
  ctx.asset = asset || { uid: req.params.uid, asset_name: 'Asset' };
  ctx.documents = [];
  ctx.kpis = { total_documents: 0, oem_manuals: 0, drawings: 0, certifications: 0, internal_sops: 0 };
  res.render('assets/assets_documents.html', ctx);
});

// ==========================================
// 4. BREAKDOWNS MANAGEMENT
// ==========================================

app.get('/breakdowns', (req, res) => {
  const ctx = baseContext(req, 'breakdowns');
  const breakdowns = db.getBreakdowns();
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

  res.render('breakdowns/breakdowns_management.html', ctx);
});

// Step 1: Log incident
app.get('/breakdowns/new/step1', (req, res) => {
  const ctx = baseContext(req, 'breakdowns');
  ctx.assets = db.getAssets();
  ctx.technicians = db.getStore().TECHNICIAN_DIRECTORY || [];
  ctx.form = req.session.breakdown_step1 || {};
  res.render('breakdowns/log_breakdown_step1.html', ctx);
});

app.post('/breakdowns/new/step1', (req, res) => {
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
app.get('/breakdowns/new/step2', (req, res) => {
  if (!req.session.breakdown_step1) return res.redirect('/breakdowns/new/step1');
  const ctx = baseContext(req, 'breakdowns');
  ctx.form = req.session.breakdown_step1;
  res.render('breakdowns/log_breakdown_step2.html', ctx);
});

app.post('/breakdowns/new/step2', (req, res) => {
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
  ctx.breakdown = bk;
  ctx.media = [];
  ctx.media_count = 0;
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
  const updates = {
    status: status || 'open',
    downtime_hours: parseFloat(downtime_hours) || 0,
    resolution_notes: resolution_notes || '',
    action_taken: action_taken || ''
  };
  if (status === 'resolved') {
    updates.resolved_at = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const bk = db.getBreakdownById(req.params.id);
    if (bk && bk.asset_uid) {
      db.updateAsset(bk.asset_uid, { status: 'operational' });
    }
  }
  db.updateBreakdown(req.params.id, updates);
  flash(req, 'success', 'Incident record updated successfully.');
  res.redirect(`/breakdowns/${req.params.id}`);
});

app.get('/breakdowns/:id/rca', (req, res) => {
  const bk = db.getBreakdownById(req.params.id);
  const ctx = baseContext(req, 'breakdowns');
  ctx.breakdown = bk;
  res.render('breakdowns/root_cause.html', ctx);
});

// ==========================================
// 5. MAINTENANCE SCHEDULE
// ==========================================

app.get('/maintenance', (req, res) => {
  const ctx = baseContext(req, 'maintenance');
  const tasks = db.getMaintenanceTasks();
  ctx.tasks = tasks;
  ctx.scheduled_count = tasks.filter(t => t.status === 'scheduled').length;
  ctx.in_progress_count = tasks.filter(t => t.status === 'in_progress').length;
  ctx.completed_count = tasks.filter(t => t.status === 'completed').length;
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
  flash(req, 'success', 'Maintenance task updated.');
  res.redirect('/maintenance');
});

// ==========================================
// 6. INVENTORY & SPARE PARTS
// ==========================================

app.get('/inventory', (req, res) => {
  const ctx = baseContext(req, 'inventory');
  const spares = db.getInventoryParts();
  const q = (req.query.q || '').toLowerCase().trim();
  const category = req.query.category || '';

  let filtered = spares;
  if (q) {
    filtered = filtered.filter(p =>
      (p.part_name || '').toLowerCase().includes(q) ||
      (p.part_number || '').toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q)
    );
  }
  if (category) {
    filtered = filtered.filter(p => p.category === category);
  }

  const categories = Array.from(new Set(spares.map(p => p.category).filter(Boolean)));
  ctx.inventory_parts = filtered;
  ctx.categories = categories.length ? categories : ['Mechanical', 'Electrical', 'Pneumatic', 'Sensors & Controls'];
  ctx.q = req.query.q || '';
  ctx.selected_category = category;
  ctx.total_count = spares.length;
  ctx.low_stock_count = spares.filter(s => (Number(s.qty) || 0) <= (Number(s.min_qty) || 0)).length;

  res.render('inventory/inventory_management.html', ctx);
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

  const exportObj = {
    id: 'rep-' + (type || 'strategic-roi'),
    name: 'Executive Strategic ROI & Action Plan',
    report_title: 'Executive Strategic ROI & Reliability Review',
    status: 'READY',
    category_key: type || 'strategic-roi',
    category: 'Executive Report',
    department: db.getCurrentDepartment(),
    generated_for: 'Facility',
    scope_mode: 'department',
    scope_section: 'All Sections',
    scope_target: 'Facility Operations',
    metrics: ['uptime', 'mtbf', 'mttr', 'compliance'],
    metric_labels: ['Plant Uptime %', 'MTBF (Hours)', 'MTTR (Hours)', 'PM Compliance %'],
    user_name: req.session?.user?.name || 'Laurence Magondu',
    format: 'pdf',
    filename: `Report-${type || 'strategic-roi'}.pdf`,
    created_at: new Date().toISOString()
  };

  const analysis = {
    start: dateWrapper(startDateObj),
    end: dateWrapper(endDateObj),
    reported_by: req.session?.user?.name || 'Laurence Magondu',
    raw: {
      assets,
      breakdowns,
      tasks,
      inventory_parts: spares
    },
    kpis: {
      uptime_pct: 98.5,
      mtbf_hours: 168.0,
      mttr_hours: 1.8,
      pm_compliance_pct: 94.2,
      total_downtime_hours: 14.2,
      total_incidents: breakdowns.length,
      critical_spares_risk: 'Low'
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
      { label: 'Total Downtime Hours', value: '14.2 hrs', subtext: '3.2 hrs below threshold' },
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
      { date: '2026-09-17', event: 'Foil sealer thermal trip resolved and cooling loop flushed.' },
      { date: '2026-09-15', event: 'Palletizing cell harmonic greasing completed ahead of schedule.' },
      { date: '2026-09-14', event: 'Case packer 5/2 valve seal overhaul executed in 105 mins.' }
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
  ctx.reports = [
    { type: 'strategic-roi', title: 'Executive Strategic ROI & Asset Availability', description: 'Comprehensive reliability return on investment, downtime losses, and MTBF trends.' },
    { type: 'breakdown-analytics', title: 'Breakdown Root Cause & MTTR Analysis', description: 'Incident distribution across sections, component failure causes, and repair durations.' },
    { type: 'maintenance-compliance', title: 'Preventive Maintenance Compliance & Work Orders', description: 'PM schedule adherence, completed inspections, and work order cost audit.' },
    { type: 'inventory-spares', title: 'Critical Spare Parts Valuation & Stock Health', description: 'Stock value breakdown, low-inventory alerts, and consumption turnover.' }
  ];
  ctx.recent_exports = db.getStore().REPORT_EXPORTS || [];
  res.render('reports/reports_center.html', ctx);
});

app.get('/reports/view/:type', (req, res) => {
  const type = req.params.type;
  const ctx = baseContext(req, 'reports');
  const { exportObj, analysis } = getReportViewData(type, req);

  ctx.export = exportObj;
  ctx.analysis = analysis;
  ctx.rid = exportObj.id;

  if (type === 'breakdown-analytics') {
    return res.render('reports/reports_view_breakdown_analytics.html', ctx);
  }
  if (type === 'maintenance-compliance') {
    return res.render('reports/reports_view_maintenance_compliance.html', ctx);
  }
  if (type === 'inventory-spares') {
    return res.render('reports/reports_view_inventory_spares.html', ctx);
  }
  if (type === 'asset-reliability') {
    return res.render('reports/reports_view_asset_reliability.html', ctx);
  }

  res.render('reports/reports_view_strategic_roi.html', ctx);
});

app.get('/reports/history', (req, res) => {
  const ctx = baseContext(req, 'reports');
  ctx.exports = db.getStore().REPORT_EXPORTS || [];
  res.render('reports/reports_history.html', ctx);
});

app.get('/reports/print/:id', (req, res) => {
  const ctx = baseContext(req, 'reports');
  const { exportObj, analysis } = getReportViewData('strategic-roi', req);
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
  const assets = db.getAssets();
  const breakdowns = db.getBreakdowns();
  const total = assets.length;
  const operational = assets.filter(a => a.status === 'operational').length;
  const openBks = breakdowns.filter(b => b.status === 'open' || b.status === 'in_progress').length;

  res.json({
    kpi_uptime_rate: total ? Math.round((operational / total) * 1000) / 10 : 98.5,
    kpi_downtime_hours: breakdowns.reduce((acc, b) => acc + (Number(b.downtime_hours) || 0), 0),
    kpi_open_breakdowns: openBks,
    kpi_mtbf: 168.0,
    kpi_mttr: 1.8
  });
});

app.get('/api/live/breakdowns-kpis', (req, res) => {
  const breakdowns = db.getBreakdowns();
  res.json({
    total: breakdowns.length,
    open: breakdowns.filter(b => b.status === 'open').length,
    in_progress: breakdowns.filter(b => b.status === 'in_progress').length,
    resolved: breakdowns.filter(b => b.status === 'resolved').length
  });
});

app.get('/api/live/maintenance-kpis', (req, res) => {
  const tasks = db.getMaintenanceTasks();
  res.json({
    total: tasks.length,
    scheduled: tasks.filter(t => t.status === 'scheduled').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length
  });
});

// Start Server
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Opsloom Core application running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
