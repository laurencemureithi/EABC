const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

function getPool() {
  if (!pool && process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    pool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]:', err.message);
    });
  }
  return pool;
}

const DATASTORE_PATH = path.join(__dirname, '..', '..', 'data', 'datastore.json');

// --- DATABASE ACCESS HELPERS ---

async function query(sql, params = []) {
  const p = getPool();
  if (p) {
    try {
      return await p.query(sql, params);
    } catch (err) {
      console.error('[PostgreSQL Query Error]:', err.message, 'SQL:', sql);
      throw err;
    }
  }
  return null;
}

// ----------------------------------------------------
// COMPANIES (WORKSPACES)
// ----------------------------------------------------
async function getCompanies() {
  const res = await query('SELECT * FROM companies ORDER BY (id = \'comp-001\') DESC, name ASC;');
  if (res && res.rows) {
    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      primary_color: r.primary_color,
      secondary_color: r.secondary_color,
      logo_light_url: r.logo_light_url,
      logo_dark_url: r.logo_dark_url,
      show_name_next_to_logo: r.show_name_next_to_logo,
      logo_height: r.logo_height,
      logo_width_pct: r.logo_width_pct,
      logo_alignment: r.logo_alignment,
      logo_fit: r.logo_fit,
      designation_line_1: r.designation_line_1,
      designation_line_2: r.designation_line_2,
      designation_line_3: r.designation_line_3,
      departments: r.departments_json ? JSON.parse(r.departments_json) : ['Engineering', 'Production'],
      kpi_targets: r.kpi_targets_json ? JSON.parse(r.kpi_targets_json) : {},
      created_at: r.created_at
    }));
  }
  return null;
}

async function upsertCompany(c) {
  const sql = `
    INSERT INTO companies (id, name, code, primary_color, secondary_color, logo_light_url, logo_dark_url, show_name_next_to_logo, logo_height, logo_width_pct, logo_alignment, logo_fit, designation_line_1, designation_line_2, designation_line_3, departments_json, kpi_targets_json, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      code = EXCLUDED.code,
      primary_color = EXCLUDED.primary_color,
      secondary_color = EXCLUDED.secondary_color,
      logo_light_url = EXCLUDED.logo_light_url,
      logo_dark_url = EXCLUDED.logo_dark_url,
      show_name_next_to_logo = EXCLUDED.show_name_next_to_logo,
      logo_height = EXCLUDED.logo_height,
      logo_width_pct = EXCLUDED.logo_width_pct,
      logo_alignment = EXCLUDED.logo_alignment,
      logo_fit = EXCLUDED.logo_fit,
      designation_line_1 = EXCLUDED.designation_line_1,
      designation_line_2 = EXCLUDED.designation_line_2,
      designation_line_3 = EXCLUDED.designation_line_3,
      departments_json = EXCLUDED.departments_json,
      kpi_targets_json = EXCLUDED.kpi_targets_json
    RETURNING *;
  `;
  const params = [
    c.id, c.name, c.code, c.primary_color || '#1554FF', c.secondary_color || '#F59E0B',
    c.logo_light_url || '/static/brand/opsloom_wordmark_light.png', c.logo_dark_url || '/static/brand/opsloom_wordmark_light.png',
    Boolean(c.show_name_next_to_logo), c.logo_height || 48, c.logo_width_pct || 100,
    c.logo_alignment || 'left', c.logo_fit || 'contain',
    c.designation_line_1 || '', c.designation_line_2 || '', c.designation_line_3 || '',
    JSON.stringify(c.departments || ['Engineering']), JSON.stringify(c.kpi_targets || {}),
    c.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteCompany(id) {
  // First reassign any assets or users associated with this company to fallback comp-001
  await query('UPDATE assets SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
  await query('UPDATE users SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
  await query('UPDATE breakdowns SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
  await query('UPDATE maintenance_tasks SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
  await query('UPDATE inventory_parts SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
  return await query('DELETE FROM companies WHERE id = $1 RETURNING *;', [id]);
}

// ----------------------------------------------------
// ASSETS
// ----------------------------------------------------
async function getAssets(companyId = null) {
  let sql = 'SELECT * FROM assets';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1';
    params.push(companyId);
  }
  sql += ' ORDER BY registered_at DESC, asset_id ASC;';
  const res = await query(sql, params);
  if (res && res.rows) {
    return res.rows.map(r => ({
      uid: r.uid,
      company_id: r.company_id,
      asset_id: r.asset_id,
      asset_name: r.asset_name,
      section: r.section,
      department: r.department,
      status: r.status,
      criticality: r.criticality,
      serial_no: r.serial_no,
      manufacturer: r.manufacturer,
      model_number: r.model_number,
      power_rating: r.power_rating,
      supplier: r.supplier,
      installation_date: r.installation_date,
      year_of_manufacture: r.year_of_manufacture,
      warranty_expiry: r.warranty_expiry,
      technical_notes: r.technical_notes,
      category: r.category,
      location: r.location,
      service_provider: r.service_provider,
      asset_value: r.asset_value,
      photo_url: r.photo_url,
      registered_at: r.registered_at,
      created_at: r.created_at
    }));
  }
  return null;
}

async function upsertAsset(a) {
  const sql = `
    INSERT INTO assets (uid, company_id, asset_id, asset_name, section, department, status, criticality, serial_no, manufacturer, model_number, power_rating, supplier, installation_date, year_of_manufacture, warranty_expiry, technical_notes, category, location, service_provider, asset_value, photo_url, registered_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
    ON CONFLICT (uid) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      asset_id = EXCLUDED.asset_id,
      asset_name = EXCLUDED.asset_name,
      section = EXCLUDED.section,
      department = EXCLUDED.department,
      status = EXCLUDED.status,
      criticality = EXCLUDED.criticality,
      serial_no = EXCLUDED.serial_no,
      manufacturer = EXCLUDED.manufacturer,
      model_number = EXCLUDED.model_number,
      power_rating = EXCLUDED.power_rating,
      supplier = EXCLUDED.supplier,
      installation_date = EXCLUDED.installation_date,
      year_of_manufacture = EXCLUDED.year_of_manufacture,
      warranty_expiry = EXCLUDED.warranty_expiry,
      technical_notes = EXCLUDED.technical_notes,
      category = EXCLUDED.category,
      location = EXCLUDED.location,
      service_provider = EXCLUDED.service_provider,
      asset_value = EXCLUDED.asset_value,
      photo_url = EXCLUDED.photo_url
    RETURNING *;
  `;
  const params = [
    a.uid, a.company_id || 'comp-001', a.asset_id, a.asset_name,
    a.section || 'General', a.department || 'Engineering', a.status || 'operational', a.criticality || 'A',
    a.serial_no || '', a.manufacturer || '', a.model_number || '', a.power_rating || '',
    a.supplier || '', a.installation_date || '', a.year_of_manufacture || '', a.warranty_expiry || '',
    a.technical_notes || '', a.category || '', a.location || '', a.service_provider || '',
    a.asset_value || '', a.photo_url || '', a.registered_at || '', a.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteAsset(uid) {
  return await query('DELETE FROM assets WHERE uid = $1 OR asset_id = $1 RETURNING *;', [uid]);
}

// ----------------------------------------------------
// RECYCLE BIN
// ----------------------------------------------------
async function getRecycleBin(companyId = null) {
  let sql = 'SELECT * FROM recycle_bin';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1 OR company_id IS NULL';
    params.push(companyId);
  }
  sql += ' ORDER BY deleted_at_iso DESC, id DESC;';
  const res = await query(sql, params);
  if (res && res.rows) {
    return res.rows.map(r => ({
      id: r.id,
      bin_id: r.id,
      company_id: r.company_id,
      entity_type: r.entity_type,
      entity_label: r.entity_label,
      primary_id: r.primary_id,
      deleted_by: r.deleted_by_name,
      deleted_by_email: r.deleted_by_email,
      deleted_by_role: r.deleted_by_role,
      deleted_at: r.deleted_at,
      deleted_at_iso: r.deleted_at_iso,
      record: r.record_data ? JSON.parse(r.record_data) : {},
      summary: r.summary
    }));
  }
  return null;
}

async function addToRecycleBin(item) {
  const sql = `
    INSERT INTO recycle_bin (id, company_id, entity_type, entity_label, primary_id, deleted_by_name, deleted_by_email, deleted_by_role, deleted_at, deleted_at_iso, record_data, summary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO UPDATE SET
      record_data = EXCLUDED.record_data,
      summary = EXCLUDED.summary
    RETURNING *;
  `;
  const bid = item.bin_id || item.id || `bin-${Date.now()}`;
  const params = [
    bid, item.company_id || null, item.entity_type, item.entity_label, item.primary_id || item.identifier || bid,
    item.deleted_by || item.deleted_by_name || 'Administrator', item.deleted_by_email || '', item.deleted_by_role || '',
    item.deleted_at || new Date().toLocaleDateString(), item.deleted_at_iso || new Date().toISOString(),
    JSON.stringify(item.record || {}), item.summary || ''
  ];
  return await query(sql, params);
}

async function removeFromRecycleBin(id) {
  return await query('DELETE FROM recycle_bin WHERE id = $1 RETURNING *;', [id]);
}

// ----------------------------------------------------
// BREAKDOWNS, MAINTENANCE, INVENTORY, USERS
// ----------------------------------------------------
async function getBreakdowns(companyId = null) {
  let sql = 'SELECT * FROM breakdowns';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1';
    params.push(companyId);
  }
  sql += ' ORDER BY reported_dt DESC;';
  const res = await query(sql, params);
  return res && res.rows ? res.rows : null;
}

async function upsertBreakdown(b) {
  const sql = `
    INSERT INTO breakdowns (breakdown_id, company_id, asset_uid, asset_id, asset_name, incident_title, section, department, reported_dt, failure_category, severity, symptoms, technician_name, technician_phone, technician_email, status, notes, duration_mins, resolved_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (breakdown_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      asset_uid = EXCLUDED.asset_uid,
      asset_id = EXCLUDED.asset_id,
      asset_name = EXCLUDED.asset_name,
      incident_title = EXCLUDED.incident_title,
      section = EXCLUDED.section,
      department = EXCLUDED.department,
      reported_dt = EXCLUDED.reported_dt,
      failure_category = EXCLUDED.failure_category,
      severity = EXCLUDED.severity,
      symptoms = EXCLUDED.symptoms,
      technician_name = EXCLUDED.technician_name,
      technician_phone = EXCLUDED.technician_phone,
      technician_email = EXCLUDED.technician_email,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      duration_mins = EXCLUDED.duration_mins,
      resolved_at = EXCLUDED.resolved_at
    RETURNING *;
  `;
  const params = [
    b.breakdown_id, b.company_id || 'comp-001', b.asset_uid || '', b.asset_id, b.asset_name,
    b.incident_title, b.section || '', b.department || '', b.reported_dt || new Date().toISOString(),
    b.failure_category || '', b.severity || 'Medium', b.symptoms || '', b.technician_name || '',
    b.technician_phone || '', b.technician_email || '', b.status || 'Open', b.notes || '',
    b.duration_mins || 0, b.resolved_at || '', b.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteBreakdown(id) {
  return await query('DELETE FROM breakdowns WHERE breakdown_id = $1 RETURNING *;', [id]);
}

async function getMaintenanceTasks(companyId = null) {
  let sql = 'SELECT * FROM maintenance_tasks';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1';
    params.push(companyId);
  }
  sql += ' ORDER BY due_date ASC;';
  const res = await query(sql, params);
  return res && res.rows ? res.rows : null;
}

async function upsertMaintenanceTask(t) {
  const sql = `
    INSERT INTO maintenance_tasks (task_id, company_id, asset_uid, asset_id, asset_name, maintenance_type, frequency, section, technician, task_title, task_description, due_date, status, priority, notes, completed_at, completion_notes, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (task_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      asset_uid = EXCLUDED.asset_uid,
      asset_id = EXCLUDED.asset_id,
      asset_name = EXCLUDED.asset_name,
      maintenance_type = EXCLUDED.maintenance_type,
      frequency = EXCLUDED.frequency,
      section = EXCLUDED.section,
      technician = EXCLUDED.technician,
      task_title = EXCLUDED.task_title,
      task_description = EXCLUDED.task_description,
      due_date = EXCLUDED.due_date,
      status = EXCLUDED.status,
      priority = EXCLUDED.priority,
      notes = EXCLUDED.notes,
      completed_at = EXCLUDED.completed_at,
      completion_notes = EXCLUDED.completion_notes
    RETURNING *;
  `;
  const params = [
    t.task_id, t.company_id || 'comp-001', t.asset_uid || '', t.asset_id, t.asset_name,
    t.maintenance_type || 'Preventive', t.frequency || 'Monthly', t.section || '', t.technician || '',
    t.task_title || '', t.task_description || '', t.due_date || '', t.status || 'Scheduled',
    t.priority || 'Medium', t.notes || '', t.completed_at || '', t.completion_notes || '',
    t.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteMaintenanceTask(id) {
  return await query('DELETE FROM maintenance_tasks WHERE task_id = $1 RETURNING *;', [id]);
}

async function getInventoryParts(companyId = null) {
  let sql = 'SELECT * FROM inventory_parts';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1';
    params.push(companyId);
  }
  sql += ' ORDER BY part_name ASC;';
  const res = await query(sql, params);
  return res && res.rows ? res.rows : null;
}

async function upsertInventoryPart(p) {
  const sql = `
    INSERT INTO inventory_parts (uid, company_id, part_name, sku, category, qty, min_qty, storage_location, unit_price, supplier, lead_time_days, is_critical, manufacturer, model_number, tech_specs, photo_url, doc_url, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (uid) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      part_name = EXCLUDED.part_name,
      sku = EXCLUDED.sku,
      category = EXCLUDED.category,
      qty = EXCLUDED.qty,
      min_qty = EXCLUDED.min_qty,
      storage_location = EXCLUDED.storage_location,
      unit_price = EXCLUDED.unit_price,
      supplier = EXCLUDED.supplier,
      lead_time_days = EXCLUDED.lead_time_days,
      is_critical = EXCLUDED.is_critical,
      manufacturer = EXCLUDED.manufacturer,
      model_number = EXCLUDED.model_number,
      tech_specs = EXCLUDED.tech_specs,
      photo_url = EXCLUDED.photo_url,
      doc_url = EXCLUDED.doc_url
    RETURNING *;
  `;
  const params = [
    p.uid, p.company_id || 'comp-001', p.part_name, p.sku, p.category || 'Mechanical',
    p.qty || 0, p.min_qty || 0, p.storage_location || '', p.unit_price || '', p.supplier || '',
    p.lead_time_days || 0, Boolean(p.is_critical), p.manufacturer || '', p.model_number || '',
    p.tech_specs || '', p.photo_url || '', p.doc_url || '', p.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteInventoryPart(uid) {
  return await query('DELETE FROM inventory_parts WHERE uid = $1 OR sku = $1 RETURNING *;', [uid]);
}

module.exports = {
  getPool,
  query,
  getCompanies,
  upsertCompany,
  deleteCompany,
  getAssets,
  upsertAsset,
  deleteAsset,
  getBreakdowns,
  upsertBreakdown,
  deleteBreakdown,
  getMaintenanceTasks,
  upsertMaintenanceTask,
  deleteMaintenanceTask,
  getInventoryParts,
  upsertInventoryPart,
  deleteInventoryPart,
  getRecycleBin,
  addToRecycleBin,
  removeFromRecycleBin,
};
