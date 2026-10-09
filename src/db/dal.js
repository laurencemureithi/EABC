const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    pool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 15,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]:', err.message);
    });
  }
  return pool;
}

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
  throw new Error('PostgreSQL pool is not configured or available.');
}

async function withTransaction(fn) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
      primary_color: r.primary_color || '#1554FF',
      secondary_color: r.secondary_color || '#F59E0B',
      logo_light_url: r.logo_light_url || '/static/brand/opsloom_wordmark_light.png',
      logo_dark_url: r.logo_dark_url || '/static/brand/opsloom_wordmark_dark.png',
      show_name_next_to_logo: Boolean(r.show_name_next_to_logo),
      logo_height: r.logo_height || 48,
      logo_width_pct: r.logo_width_pct || 100,
      logo_alignment: r.logo_alignment || 'left',
      logo_fit: r.logo_fit || 'contain',
      designation_line_1: r.designation_line_1 || `${r.name} (${r.code})`,
      designation_line_2: r.designation_line_2 || 'Headquarters & Plant Operations',
      designation_line_3: r.designation_line_3 || 'Industrial & Manufacturing Operations',
      departments: r.departments_json ? JSON.parse(r.departments_json) : ['Engineering', 'Production'],
      kpi_targets: r.kpi_targets_json ? JSON.parse(r.kpi_targets_json) : {},
      created_at: r.created_at
    }));
  }
  return [];
}

async function getCompanyById(id) {
  if (!id) return null;
  const res = await query('SELECT * FROM companies WHERE id = $1 LIMIT 1;', [id]);
  if (res && res.rows && res.rows[0]) {
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      primary_color: r.primary_color,
      secondary_color: r.secondary_color,
      logo_light_url: r.logo_light_url,
      logo_dark_url: r.logo_dark_url,
      show_name_next_to_logo: Boolean(r.show_name_next_to_logo),
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
    };
  }
  return null;
}

async function upsertCompany(c) {
  // Enforce code and name uniqueness at the business layer:
  // Check if another company with same code or name exists
  const existingCode = await query('SELECT id, name, code FROM companies WHERE LOWER(code) = LOWER($1) AND id != $2 LIMIT 1;', [c.code, c.id || '']);
  if (existingCode && existingCode.rows && existingCode.rows.length > 0) {
    throw new Error(`Workspace code "${c.code}" is already in use by "${existingCode.rows[0].name}" (${existingCode.rows[0].id}).`);
  }
  const existingName = await query('SELECT id, name, code FROM companies WHERE LOWER(name) = LOWER($1) AND id != $2 LIMIT 1;', [c.name, c.id || '']);
  if (existingName && existingName.rows && existingName.rows.length > 0) {
    throw new Error(`Workspace name "${c.name}" is already in use by code "${existingName.rows[0].code}" (${existingName.rows[0].id}).`);
  }

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
    c.logo_light_url || '/static/brand/opsloom_wordmark_light.png', c.logo_dark_url || '/static/brand/opsloom_wordmark_dark.png',
    Boolean(c.show_name_next_to_logo), c.logo_height || 48, c.logo_width_pct || 100,
    c.logo_alignment || 'left', c.logo_fit || 'contain',
    c.designation_line_1 || '', c.designation_line_2 || '', c.designation_line_3 || '',
    JSON.stringify(c.departments || ['Engineering']), JSON.stringify(c.kpi_targets || {}),
    c.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteCompany(id, actor = {}) {
  return await withTransaction(async (client) => {
    // 1. Fetch company record before deletion
    const existing = await client.query('SELECT * FROM companies WHERE id = $1;', [id]);
    if (!existing || !existing.rows || !existing.rows.length) {
      return null;
    }
    const compRow = existing.rows[0];

    // 2. Add to recycle bin
    const binId = `bin-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const nowIso = new Date().toISOString();
    const nowDisplay = new Date().toLocaleDateString();

    await client.query(`
      INSERT INTO recycle_bin (id, company_id, entity_type, entity_label, primary_id, deleted_by_name, deleted_by_email, deleted_by_role, deleted_at, deleted_at_iso, record_data, summary)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET record_data = EXCLUDED.record_data;
    `, [
      binId,
      'comp-001',
      'company',
      `${compRow.name} (${compRow.code})`,
      compRow.id,
      actor.name || 'Administrator',
      actor.email || 'opsloom.ke@gmail.com',
      actor.role || 'Administrator',
      nowDisplay,
      nowIso,
      JSON.stringify(compRow),
      `Deleted workspace ${compRow.name} (${compRow.code})`
    ]);

    // 3. Reassign related rows to fallback comp-001
    await client.query('UPDATE assets SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
    await client.query('UPDATE users SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
    await client.query('UPDATE breakdowns SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
    await client.query('UPDATE maintenance_tasks SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
    await client.query('UPDATE inventory_parts SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);
    await client.query('UPDATE technicians SET company_id = \'comp-001\' WHERE company_id = $1;', [id]);

    // 4. Delete company
    const delRes = await client.query('DELETE FROM companies WHERE id = $1 RETURNING *;', [id]);

    // 5. Add smart notification
    const notifId = `notif-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await client.query(`
      INSERT INTO notifications (id, user_id, company_id, event_type, entity_module, entity_id, title, message, severity, is_read, is_toasted, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, $10);
    `, [
      notifId,
      null,
      'comp-001',
      'workspace_deleted',
      'companies',
      compRow.id,
      'Workspace Deleted',
      `Workspace "${compRow.name}" (${compRow.code}) was moved to Recycle Bin.`,
      'warning',
      nowIso
    ]);

    return delRes;
  });
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
  return [];
}

async function getAssetByUid(identifier) {
  if (!identifier) return null;
  const res = await query('SELECT * FROM assets WHERE uid = $1 OR asset_id = $1 LIMIT 1;', [identifier]);
  if (res && res.rows && res.rows[0]) {
    const r = res.rows[0];
    return {
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
    };
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

async function deleteAsset(uid, actor = {}) {
  return await withTransaction(async (client) => {
    // 1. Fetch asset record
    const existing = await client.query('SELECT * FROM assets WHERE uid = $1 OR asset_id = $1 LIMIT 1;', [uid]);
    if (!existing || !existing.rows || !existing.rows.length) {
      return null;
    }
    const assetRow = existing.rows[0];

    // 2. Add to recycle bin
    const binId = `bin-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const nowIso = new Date().toISOString();
    const nowDisplay = new Date().toLocaleDateString();

    await client.query(`
      INSERT INTO recycle_bin (id, company_id, entity_type, entity_label, primary_id, deleted_by_name, deleted_by_email, deleted_by_role, deleted_at, deleted_at_iso, record_data, summary)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET record_data = EXCLUDED.record_data;
    `, [
      binId,
      assetRow.company_id || 'comp-001',
      'asset',
      `${assetRow.asset_name} (${assetRow.asset_id})`,
      assetRow.uid,
      actor.name || 'Administrator',
      actor.email || 'opsloom.ke@gmail.com',
      actor.role || 'Administrator',
      nowDisplay,
      nowIso,
      JSON.stringify(assetRow),
      `Deleted asset ${assetRow.asset_name} (${assetRow.asset_id})`
    ]);

    // 3. Delete from assets
    const delRes = await client.query('DELETE FROM assets WHERE uid = $1 OR asset_id = $1 RETURNING *;', [uid]);

    // 4. Create event-driven notification
    const notifId = `notif-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await client.query(`
      INSERT INTO notifications (id, user_id, company_id, event_type, entity_module, entity_id, title, message, severity, is_read, is_toasted, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, $10);
    `, [
      notifId,
      null,
      assetRow.company_id || 'comp-001',
      'asset_deleted',
      'assets',
      assetRow.uid,
      'Asset Deleted',
      `Asset ${assetRow.asset_name} (${assetRow.asset_id}) was moved to Recycle Bin.`,
      'warning',
      nowIso
    ]);

    return delRes;
  });
}

// ----------------------------------------------------
// RECYCLE BIN & LIFECYCLE
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
      record: r.record_data ? (typeof r.record_data === 'string' ? JSON.parse(r.record_data) : r.record_data) : {},
      summary: r.summary
    }));
  }
  return [];
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
  return await query('DELETE FROM recycle_bin WHERE id = $1 OR primary_id = $1 RETURNING *;', [id]);
}

async function restoreFromRecycleBin(binId, actor = {}) {
  return await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM recycle_bin WHERE id = $1 OR primary_id = $1 LIMIT 1;', [binId]);
    if (!res || !res.rows || !res.rows.length) {
      throw new Error(`Recycle bin item "${binId}" not found.`);
    }
    const item = res.rows[0];
    const rec = typeof item.record_data === 'string' ? JSON.parse(item.record_data) : item.record_data;
    const nowIso = new Date().toISOString();

    if (item.entity_type === 'company') {
      await client.query(`
        INSERT INTO companies (id, name, code, primary_color, secondary_color, logo_light_url, logo_dark_url, show_name_next_to_logo, logo_height, logo_width_pct, logo_alignment, logo_fit, designation_line_1, designation_line_2, designation_line_3, departments_json, kpi_targets_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code;
      `, [
        rec.id, rec.name, rec.code, rec.primary_color || '#1554FF', rec.secondary_color || '#F59E0B',
        rec.logo_light_url || '/static/brand/opsloom_wordmark_light.png', rec.logo_dark_url || '/static/brand/opsloom_wordmark_dark.png',
        Boolean(rec.show_name_next_to_logo), rec.logo_height || 48, rec.logo_width_pct || 100,
        rec.logo_alignment || 'left', rec.logo_fit || 'contain',
        rec.designation_line_1 || '', rec.designation_line_2 || '', rec.designation_line_3 || '',
        typeof rec.departments_json === 'string' ? rec.departments_json : JSON.stringify(rec.departments || ['Engineering']),
        typeof rec.kpi_targets_json === 'string' ? rec.kpi_targets_json : JSON.stringify(rec.kpi_targets || {}),
        rec.created_at || nowIso
      ]);
    } else if (item.entity_type === 'asset') {
      await client.query(`
        INSERT INTO assets (uid, company_id, asset_id, asset_name, section, department, status, criticality, serial_no, manufacturer, model_number, power_rating, supplier, installation_date, year_of_manufacture, warranty_expiry, technical_notes, category, location, service_provider, asset_value, photo_url, registered_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (uid) DO UPDATE SET asset_name = EXCLUDED.asset_name, status = EXCLUDED.status;
      `, [
        rec.uid, rec.company_id || 'comp-001', rec.asset_id, rec.asset_name,
        rec.section || 'General', rec.department || 'Engineering', rec.status || 'operational', rec.criticality || 'A',
        rec.serial_no || '', rec.manufacturer || '', rec.model_number || '', rec.power_rating || '',
        rec.supplier || '', rec.installation_date || '', rec.year_of_manufacture || '', rec.warranty_expiry || '',
        rec.technical_notes || '', rec.category || '', rec.location || '', rec.service_provider || '',
        rec.asset_value || '', rec.photo_url || '', rec.registered_at || '', rec.created_at || nowIso
      ]);
    } else if (item.entity_type === 'breakdown') {
      await client.query(`
        INSERT INTO breakdowns (breakdown_id, company_id, asset_uid, asset_id, asset_name, incident_title, section, department, reported_dt, failure_category, severity, symptoms, technician_name, technician_phone, technician_email, status, notes, duration_mins, resolved_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (breakdown_id) DO UPDATE SET status = EXCLUDED.status;
      `, [
        rec.breakdown_id, rec.company_id || 'comp-001', rec.asset_uid || '', rec.asset_id, rec.asset_name,
        rec.incident_title, rec.section || '', rec.department || '', rec.reported_dt || nowIso,
        rec.failure_category || '', rec.severity || 'Medium', rec.symptoms || '', rec.technician_name || '',
        rec.technician_phone || '', rec.technician_email || '', rec.status || 'Open', rec.notes || '',
        rec.duration_mins || 0, rec.resolved_at || '', rec.created_at || nowIso
      ]);
    } else if (item.entity_type === 'maintenance') {
      await client.query(`
        INSERT INTO maintenance_tasks (task_id, company_id, asset_uid, asset_id, asset_name, maintenance_type, frequency, section, technician, task_title, task_description, due_date, status, priority, notes, completed_at, completion_notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (task_id) DO UPDATE SET status = EXCLUDED.status;
      `, [
        rec.task_id, rec.company_id || 'comp-001', rec.asset_uid || '', rec.asset_id, rec.asset_name,
        rec.maintenance_type || 'Preventive', rec.frequency || 'Monthly', rec.section || '', rec.technician || '',
        rec.task_title || '', rec.task_description || '', rec.due_date || '', rec.status || 'Scheduled',
        rec.priority || 'Medium', rec.notes || '', rec.completed_at || '', rec.completion_notes || '',
        rec.created_at || nowIso
      ]);
    } else if (item.entity_type === 'inventory') {
      await client.query(`
        INSERT INTO inventory_parts (uid, company_id, part_name, sku, category, qty, min_qty, storage_location, unit_price, supplier, lead_time_days, is_critical, manufacturer, model_number, tech_specs, photo_url, doc_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (uid) DO UPDATE SET qty = EXCLUDED.qty;
      `, [
        rec.uid, rec.company_id || 'comp-001', rec.part_name, rec.sku, rec.category || 'Mechanical',
        rec.qty || 0, rec.min_qty || 0, rec.storage_location || '', rec.unit_price || '', rec.supplier || '',
        rec.lead_time_days || 0, Boolean(rec.is_critical), rec.manufacturer || '', rec.model_number || '',
        rec.tech_specs || '', rec.photo_url || '', rec.doc_url || '', rec.created_at || nowIso
      ]);
    }

    // Delete from recycle_bin
    await client.query('DELETE FROM recycle_bin WHERE id = $1;', [binId]);

    // Create event-driven notification
    const notifId = `notif-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await client.query(`
      INSERT INTO notifications (id, user_id, company_id, event_type, entity_module, entity_id, title, message, severity, is_read, is_toasted, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, $10);
    `, [
      notifId,
      null,
      item.company_id || 'comp-001',
      `${item.entity_type}_restored`,
      item.entity_type === 'company' ? 'companies' : (item.entity_type === 'asset' ? 'assets' : 'general'),
      item.primary_id,
      `${item.entity_type === 'company' ? 'Workspace' : (item.entity_type === 'asset' ? 'Asset' : 'Item')} Restored`,
      `${item.entity_label} was restored successfully.`,
      'success',
      nowIso
    ]);

    return { success: true, restored: rec, entity_type: item.entity_type };
  });
}

// ----------------------------------------------------
// USERS
// ----------------------------------------------------
async function getUsers(companyId = null) {
  let sql = 'SELECT * FROM users';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1';
    params.push(companyId);
  }
  sql += ' ORDER BY (id = \'USR-001\') DESC, name ASC;';
  const res = await query(sql, params);
  if (res && res.rows) {
    return res.rows.map(r => ({
      id: r.id,
      uid: r.uid || r.id,
      email: r.email,
      name: r.name,
      password: r.password,
      role: r.role,
      access_scope: r.access_scope,
      department: r.department,
      company_id: r.company_id,
      active: Boolean(r.active),
      permissions: r.permissions_json ? JSON.parse(r.permissions_json) : [],
      edit_permissions: r.edit_permissions_json ? JSON.parse(r.edit_permissions_json) : [],
      delete_permissions: r.delete_permissions_json ? JSON.parse(r.delete_permissions_json) : [],
      signature_name: r.signature_name,
      signature_title: r.signature_title,
      signature_font: r.signature_font,
      signature_color: r.signature_color,
      signature_style: r.signature_style,
      signature_image_url: r.signature_image_url,
      profile_image_url: r.profile_image_url,
      created_at: r.created_at
    }));
  }
  return [];
}

async function getUserByEmail(email) {
  if (!email) return null;
  const res = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;', [email.trim()]);
  if (res && res.rows && res.rows[0]) {
    const r = res.rows[0];
    return {
      id: r.id,
      uid: r.uid || r.id,
      email: r.email,
      name: r.name,
      password: r.password,
      role: r.role,
      access_scope: r.access_scope,
      department: r.department,
      company_id: r.company_id,
      active: Boolean(r.active),
      permissions: r.permissions_json ? JSON.parse(r.permissions_json) : [],
      edit_permissions: r.edit_permissions_json ? JSON.parse(r.edit_permissions_json) : [],
      delete_permissions: r.delete_permissions_json ? JSON.parse(r.delete_permissions_json) : [],
      signature_name: r.signature_name,
      signature_title: r.signature_title,
      signature_font: r.signature_font,
      signature_color: r.signature_color,
      signature_style: r.signature_style,
      signature_image_url: r.signature_image_url,
      profile_image_url: r.profile_image_url,
      created_at: r.created_at
    };
  }
  return null;
}

async function getUserById(id) {
  if (!id) return null;
  const res = await query('SELECT * FROM users WHERE id = $1 OR uid = $1 LIMIT 1;', [id]);
  if (res && res.rows && res.rows[0]) {
    const r = res.rows[0];
    return {
      id: r.id,
      uid: r.uid || r.id,
      email: r.email,
      name: r.name,
      password: r.password,
      role: r.role,
      access_scope: r.access_scope,
      department: r.department,
      company_id: r.company_id,
      active: Boolean(r.active),
      permissions: r.permissions_json ? JSON.parse(r.permissions_json) : [],
      edit_permissions: r.edit_permissions_json ? JSON.parse(r.edit_permissions_json) : [],
      delete_permissions: r.delete_permissions_json ? JSON.parse(r.delete_permissions_json) : [],
      signature_name: r.signature_name,
      signature_title: r.signature_title,
      signature_font: r.signature_font,
      signature_color: r.signature_color,
      signature_style: r.signature_style,
      signature_image_url: r.signature_image_url,
      profile_image_url: r.profile_image_url,
      created_at: r.created_at
    };
  }
  return null;
}

async function upsertUser(u) {
  const sql = `
    INSERT INTO users (id, uid, email, name, password, role, access_scope, department, company_id, active, permissions_json, edit_permissions_json, delete_permissions_json, signature_name, signature_title, signature_font, signature_color, signature_style, signature_image_url, profile_image_url, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      password = COALESCE(EXCLUDED.password, users.password),
      role = EXCLUDED.role,
      access_scope = EXCLUDED.access_scope,
      department = EXCLUDED.department,
      company_id = EXCLUDED.company_id,
      active = EXCLUDED.active,
      permissions_json = EXCLUDED.permissions_json,
      edit_permissions_json = EXCLUDED.edit_permissions_json,
      delete_permissions_json = EXCLUDED.delete_permissions_json,
      signature_name = EXCLUDED.signature_name,
      signature_title = EXCLUDED.signature_title,
      signature_font = EXCLUDED.signature_font,
      signature_color = EXCLUDED.signature_color,
      signature_style = EXCLUDED.signature_style,
      signature_image_url = EXCLUDED.signature_image_url,
      profile_image_url = EXCLUDED.profile_image_url
    RETURNING *;
  `;
  const params = [
    u.id, u.uid || u.id, u.email, u.name, u.password || null,
    u.role || 'Staff Member', u.access_scope || 'Standard', u.department || 'Engineering',
    u.company_id || 'comp-001', u.active !== false,
    JSON.stringify(u.permissions || []), JSON.stringify(u.edit_permissions || []), JSON.stringify(u.delete_permissions || []),
    u.signature_name || u.name, u.signature_title || u.role, u.signature_font || 'Inter',
    u.signature_color || '#1554FF', u.signature_style || 'formal',
    u.signature_image_url || '', u.profile_image_url || '',
    u.created_at || new Date().toISOString()
  ];
  return await query(sql, params);
}

async function deleteUser(id) {
  return await query('DELETE FROM users WHERE id = $1 RETURNING *;', [id]);
}

// ----------------------------------------------------
// NOTIFICATIONS (EVENT-DRIVEN & REAL SMART NOTIFICATIONS)
// ----------------------------------------------------
async function getNotifications(userId = null, companyId = null) {
  let sql = 'SELECT * FROM notifications WHERE 1=1';
  const params = [];
  if (companyId) {
    params.push(companyId);
    sql += ` AND (company_id = $${params.length} OR company_id = 'comp-001' OR company_id IS NULL)`;
  }
  if (userId) {
    params.push(userId);
    sql += ` AND (user_id = $${params.length} OR user_id IS NULL)`;
  }
  sql += ' ORDER BY created_at DESC LIMIT 50;';
  const res = await query(sql, params);
  return res && res.rows ? res.rows : [];
}

async function getUnreadNotificationCount(userId = null, companyId = null) {
  let sql = 'SELECT COUNT(*) FROM notifications WHERE is_read = false';
  const params = [];
  if (companyId) {
    params.push(companyId);
    sql += ` AND (company_id = $${params.length} OR company_id = 'comp-001' OR company_id IS NULL)`;
  }
  if (userId) {
    params.push(userId);
    sql += ` AND (user_id = $${params.length} OR user_id IS NULL)`;
  }
  const res = await query(sql, params);
  return res && res.rows ? Number(res.rows[0].count) : 0;
}

async function addNotification({ userId, companyId, eventType, entityModule, entityId, title, message, severity = 'info' }) {
  const notifId = `notif-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  const nowIso = new Date().toISOString();
  const sql = `
    INSERT INTO notifications (id, user_id, company_id, event_type, entity_module, entity_id, title, message, severity, is_read, is_toasted, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, $10)
    RETURNING *;
  `;
  return await query(sql, [notifId, userId || null, companyId || 'comp-001', eventType, entityModule, entityId || null, title, message, severity, nowIso]);
}

async function getRecentToasts(userId = null, companyId = null) {
  let sql = 'SELECT * FROM notifications WHERE is_toasted = false';
  const params = [];
  if (companyId) {
    params.push(companyId);
    sql += ` AND (company_id = $${params.length} OR company_id = 'comp-001' OR company_id IS NULL)`;
  }
  if (userId) {
    params.push(userId);
    sql += ` AND (user_id = $${params.length} OR user_id IS NULL)`;
  }
  sql += ' ORDER BY created_at DESC LIMIT 5;';
  const res = await query(sql, params);
  if (res && res.rows && res.rows.length > 0) {
    const ids = res.rows.map(r => r.id);
    await query('UPDATE notifications SET is_toasted = true WHERE id = ANY($1);', [ids]);
    return res.rows;
  }
  return [];
}

async function markNotificationRead(id) {
  return await query('UPDATE notifications SET is_read = true WHERE id = $1 RETURNING *;', [id]);
}

async function markNotificationToasted(id) {
  return await query('UPDATE notifications SET is_toasted = true WHERE id = $1 RETURNING *;', [id]);
}

async function dismissNotification(id) {
  return await query('DELETE FROM notifications WHERE id = $1 RETURNING *;', [id]);
}

// ----------------------------------------------------
// BREAKDOWNS, MAINTENANCE, INVENTORY
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
  return res && res.rows ? res.rows : [];
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
  return res && res.rows ? res.rows : [];
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
  return res && res.rows ? res.rows : [];
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

// ----------------------------------------------------
// AUDIT TRAIL
// ----------------------------------------------------
async function getAuditTrail(companyId = null, limit = 100) {
  let sql = 'SELECT * FROM audit_trail';
  const params = [];
  if (companyId) {
    sql += ' WHERE company_id = $1 OR company_id IS NULL';
    params.push(companyId);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${Number(limit) || 100};`;
  const res = await query(sql, params);
  return res && res.rows ? res.rows : [];
}

async function addAudit(entry) {
  const sql = `
    INSERT INTO audit_trail (id, company_id, action, detail, module, href, severity, user_name, user_email, user_role, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *;
  `;
  const aid = entry.id || `aud-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  const nowIso = entry.created_at || new Date().toISOString();
  return await query(sql, [
    aid, entry.company_id || 'comp-001', entry.action, entry.detail, entry.module || 'general',
    entry.href || '/dashboard', entry.severity || 'info', entry.user_name || 'System Administrator',
    entry.user_email || 'opsloom.ke@gmail.com', entry.user_role || 'Administrator', nowIso
  ]);
}

// ----------------------------------------------------
// DIAGNOSTIC INFO (PROVE DATABASE USAGE)
// ----------------------------------------------------
async function getDiagnosticInfo() {
  const p = getPool();
  if (!p) {
    return {
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_CONNECTED: false,
      DATABASE_ERROR: 'Pool not initialized'
    };
  }

  try {
    const res = await p.query('SELECT current_database(), current_user, inet_server_addr(), version();');
    const dbRow = res.rows[0] || {};

    const compCount = (await p.query('SELECT COUNT(*) FROM companies;')).rows[0].count;
    const assetCount = (await p.query('SELECT COUNT(*) FROM assets;')).rows[0].count;
    const userCount = (await p.query('SELECT COUNT(*) FROM users;')).rows[0].count;
    const bdCount = (await p.query('SELECT COUNT(*) FROM breakdowns;')).rows[0].count;
    const maintCount = (await p.query('SELECT COUNT(*) FROM maintenance_tasks;')).rows[0].count;
    const invCount = (await p.query('SELECT COUNT(*) FROM inventory_parts;')).rows[0].count;
    const binCount = (await p.query('SELECT COUNT(*) FROM recycle_bin;')).rows[0].count;
    const notifCount = (await p.query('SELECT COUNT(*) FROM notifications;')).rows[0].count;

    return {
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_HOST: process.env.SQL_HOST || 'cloud_sql_socket',
      DATABASE_NAME: dbRow.current_database || process.env.SQL_DB_NAME,
      DATABASE_CONNECTED: true,
      DATABASE_USER: dbRow.current_user,
      DATABASE_VERSION: dbRow.version ? dbRow.version.split(' ')[0] : 'PostgreSQL',
      SINGLE_AUTHORITATIVE_SOURCE: 'PostgreSQL Cloud SQL Instance',
      JSON_FALLBACK_ACTIVE: false,
      TABLE_COUNTS: {
        companies: Number(compCount),
        assets: Number(assetCount),
        users: Number(userCount),
        breakdowns: Number(bdCount),
        maintenance_tasks: Number(maintCount),
        inventory_parts: Number(invCount),
        recycle_bin: Number(binCount),
        notifications: Number(notifCount),
      }
    };
  } catch (err) {
    return {
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_HOST: process.env.SQL_HOST,
      DATABASE_NAME: process.env.SQL_DB_NAME,
      DATABASE_CONNECTED: false,
      DATABASE_ERROR: err.message
    };
  }
}

module.exports = {
  getPool,
  query,
  withTransaction,
  getCompanies,
  getCompanyById,
  upsertCompany,
  deleteCompany,
  getAssets,
  getAssetByUid,
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
  getUsers,
  getUserByEmail,
  getUserById,
  upsertUser,
  deleteUser,
  getRecycleBin,
  addToRecycleBin,
  removeFromRecycleBin,
  restoreFromRecycleBin,
  getNotifications,
  getUnreadNotificationCount,
  addNotification,
  getRecentToasts,
  markNotificationRead,
  markNotificationToasted,
  dismissNotification,
  getAuditTrail,
  addAudit,
  getDiagnosticInfo
};
