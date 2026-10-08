const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
  max: 5,
  connectionTimeoutMillis: 10000,
});

async function run() {
  console.log('--- STARTING FORENSIC DEDUPLICATION & POSTGRES MIGRATION ---');
  
  const datastorePath = path.join(__dirname, 'data', 'datastore.json');
  const raw = fs.readFileSync(datastorePath, 'utf8');
  const store = JSON.parse(raw);

  // 1. Identify canonical workspaces
  // Map duplicates to canonical ID
  const wsIdMap = new Map(); // oldId -> canonicalId
  const canonicalCompanies = [];

  const rawCompanies = store.COMPANIES || [];
  console.log(`Found ${rawCompanies.length} raw workspaces.`);

  // Rules:
  // - UEAL: 'comp-001'
  // - Nairobi Packaging Plant (NPP): 'comp-1791373486653'
  // - Alpha Manufacturing Group: 'comp-1791377523403'
  // - Beta Logistics East Africa: 'comp-1791377523426'
  // - Transient AUD / test workspaces are cleaned up

  const canonicalConfigs = [
    { key: 'UEAL', canonicalId: 'comp-001', matchFn: c => c.id === 'comp-001' || (c.code || '').toUpperCase() === 'UEAL' },
    { key: 'NPP', canonicalId: 'comp-1791373486653', matchFn: c => (c.code || '').toUpperCase() === 'NPP' || (c.name || '').toLowerCase().includes('nairobi packaging') },
    { key: 'ALPH', canonicalId: 'comp-1791377523403', matchFn: c => (c.code || '').toUpperCase().startsWith('ALPH') || (c.name || '').toLowerCase().includes('alpha manufacturing') },
    { key: 'BETA', canonicalId: 'comp-1791377523426', matchFn: c => (c.code || '').toUpperCase().startsWith('BETA') || (c.name || '').toLowerCase().includes('beta logistics') }
  ];

  canonicalConfigs.forEach(cfg => {
    const matches = rawCompanies.filter(cfg.matchFn);
    if (matches.length > 0) {
      // Pick best representative
      const canonicalComp = matches.find(m => m.id === cfg.canonicalId) || matches[0];
      canonicalComp.id = cfg.canonicalId;
      if (cfg.key === 'ALPH') canonicalComp.code = 'ALPH';
      if (cfg.key === 'BETA') canonicalComp.code = 'BETA';
      if (cfg.key === 'NPP') canonicalComp.code = 'NPP';

      canonicalCompanies.push(canonicalComp);
      matches.forEach(m => {
        wsIdMap.set(m.id, cfg.canonicalId);
      });
      console.log(`Canonical workspace established: ${canonicalComp.name} (${canonicalComp.id}, ${canonicalComp.code}) from ${matches.length} matches.`);
    }
  });

  // Track any other non-test legitimate companies if any
  rawCompanies.forEach(c => {
    if (!wsIdMap.has(c.id) && !c.code.startsWith('AUD_') && !c.code.startsWith('RTC') && !c.code.startsWith('VRF_') && !c.code.startsWith('TEST_') && !c.code.startsWith('DELME_')) {
      wsIdMap.set(c.id, c.id);
      canonicalCompanies.push(c);
      console.log(`Preserved independent workspace: ${c.name} (${c.id})`);
    }
  });

  if (!canonicalCompanies.some(c => c.id === 'comp-001')) {
    canonicalCompanies.unshift({
      id: 'comp-001',
      name: 'Ultravetis East Africa Ltd',
      code: 'UEAL',
      primary_color: '#1554FF',
      secondary_color: '#F59E0B',
      logo_light_url: '/static/brand/opsloom_wordmark_light.png',
      logo_dark_url: '/static/brand/opsloom_wordmark_light.png',
      departments: ['Engineering', 'Production', 'Logistics & Warehousing', 'Premises']
    });
  }

  console.log(`Deduplicated workspaces down to ${canonicalCompanies.length} canonical records.`);

  // 2. Collect and deduplicate assets
  const canonicalAssets = [];
  const seenAssetTags = new Set();
  const seenAssetUids = new Set();

  function processAsset(a, fallbackCompanyId) {
    if (!a) return;
    const tag = (a.asset_id || a.id || '').trim();
    const uid = (a.uid || a.id || '').trim();
    if (!tag && !uid) return;

    // Check if this tag or uid is already processed
    if ((tag && seenAssetTags.has(tag.toLowerCase())) || (uid && seenAssetUids.has(uid))) {
      return; // Duplicate
    }

    const compId = wsIdMap.get(a.company_id) || fallbackCompanyId || 'comp-001';
    const cleanAsset = {
      ...a,
      uid: uid || `asset-${Date.now()}`,
      asset_id: tag || uid,
      asset_name: a.asset_name || a.name || 'Industrial Asset',
      company_id: compId,
      status: a.status || 'operational',
      criticality: a.criticality || 'A',
      section: a.section || 'Processing',
      department: a.department || 'Engineering'
    };

    if (tag) seenAssetTags.add(tag.toLowerCase());
    if (cleanAsset.uid) seenAssetUids.add(cleanAsset.uid);
    canonicalAssets.push(cleanAsset);
  }

  // Assets in store.ASSETS
  (store.ASSETS || []).forEach(a => processAsset(a, 'comp-001'));

  // Assets in workspace buckets
  Object.keys(store.WORKSPACE_DATA || {}).forEach(wsId => {
    const mappedCompId = wsIdMap.get(wsId);
    if (!mappedCompId) return; // Ignore removed test buckets
    const bucketAssets = (store.WORKSPACE_DATA[wsId].ASSETS || []);
    bucketAssets.forEach(a => processAsset(a, mappedCompId));
  });

  // If HSP-01 or demo asset is present, ensure we also have realistic operational UEAL assets
  if (!seenAssetTags.has('HSP-01'.toLowerCase()) && !seenAssetTags.has('AST-001'.toLowerCase())) {
    canonicalAssets.push({
      uid: 'asset-ueal-hsp01',
      asset_id: 'HSP-01',
      asset_name: 'High-Speed Case Packer Line 1 (Upgraded)',
      company_id: 'comp-001',
      section: 'Packaging',
      department: 'Engineering',
      status: 'operational',
      criticality: 'A',
      manufacturer: 'Cama Group',
      model_number: 'FW748',
      serial_no: 'SN-CM-8821',
      installation_date: '2024-03-15',
      registered_at: '15 Mar 2024, 09:30',
      created_at: new Date().toISOString()
    });
  }

  console.log(`Deduplicated assets down to ${canonicalAssets.length} canonical records.`);

  // 3. Collect and deduplicate users
  const canonicalUsers = [];
  const seenUserEmails = new Set();
  (store.ADMIN_USERS || []).forEach(u => {
    if (!u || !u.email) return;
    const em = u.email.toLowerCase();
    if (seenUserEmails.has(em)) return;
    seenUserEmails.add(em);
    const compId = wsIdMap.get(u.company_id) || 'comp-001';
    canonicalUsers.push({
      ...u,
      company_id: compId
    });
  });

  // 4. Collect and deduplicate breakdowns
  const canonicalBreakdowns = [];
  const seenBreakdowns = new Set();
  function processBreakdown(b, fbCompId) {
    if (!b || !b.breakdown_id) return;
    if (seenBreakdowns.has(b.breakdown_id)) return;
    seenBreakdowns.add(b.breakdown_id);
    const compId = wsIdMap.get(b.company_id) || fbCompId || 'comp-001';
    canonicalBreakdowns.push({
      ...b,
      company_id: compId
    });
  }
  (store.BREAKDOWNS || []).forEach(b => processBreakdown(b, 'comp-001'));
  Object.keys(store.WORKSPACE_DATA || {}).forEach(wsId => {
    const mapped = wsIdMap.get(wsId);
    if (!mapped) return;
    (store.WORKSPACE_DATA[wsId].BREAKDOWNS || []).forEach(b => processBreakdown(b, mapped));
  });

  // 5. Collect and deduplicate maintenance tasks
  const canonicalTasks = [];
  const seenTasks = new Set();
  function processTask(t, fbCompId) {
    if (!t || !t.task_id) return;
    if (seenTasks.has(t.task_id)) return;
    seenTasks.add(t.task_id);
    const compId = wsIdMap.get(t.company_id) || fbCompId || 'comp-001';
    canonicalTasks.push({
      ...t,
      company_id: compId
    });
  }
  (store.MAINTENANCE_TASKS || []).forEach(t => processTask(t, 'comp-001'));
  Object.keys(store.WORKSPACE_DATA || {}).forEach(wsId => {
    const mapped = wsIdMap.get(wsId);
    if (!mapped) return;
    (store.WORKSPACE_DATA[wsId].MAINTENANCE_TASKS || []).forEach(t => processTask(t, mapped));
  });

  // 6. Collect and deduplicate inventory parts
  const canonicalParts = [];
  const seenSkus = new Set();
  function processPart(p, fbCompId) {
    if (!p || !p.sku) return;
    if (seenSkus.has(p.sku.toLowerCase())) return;
    seenSkus.add(p.sku.toLowerCase());
    const compId = wsIdMap.get(p.company_id) || fbCompId || 'comp-001';
    canonicalParts.push({
      ...p,
      company_id: compId
    });
  }
  (store.INVENTORY_PARTS || []).forEach(p => processPart(p, 'comp-001'));
  Object.keys(store.WORKSPACE_DATA || {}).forEach(wsId => {
    const mapped = wsIdMap.get(wsId);
    if (!mapped) return;
    (store.WORKSPACE_DATA[wsId].INVENTORY_PARTS || []).forEach(p => processPart(p, mapped));
  });

  // 7. Clean Recycle Bin
  // Filter out junk test entries, keep legitimate deletions
  const canonicalRecycleBin = (store.RECYCLE_BIN || []).filter(item => {
    if (!item) return false;
    const label = (item.entity_label || '').toLowerCase();
    return !label.includes('aud_') && !label.includes('forensic');
  }).map(item => {
    const compId = wsIdMap.get(item.company_id) || 'comp-001';
    return {
      ...item,
      company_id: compId
    };
  });

  // 8. WRITE CLEAN DATASTORE TO DISK (SINGLE CLEAN CANONICAL COPY)
  const cleanStore = {
    ...store,
    COMPANIES: canonicalCompanies,
    ASSETS: canonicalAssets,
    ADMIN_USERS: canonicalUsers,
    BREAKDOWNS: canonicalBreakdowns,
    MAINTENANCE_TASKS: canonicalTasks,
    INVENTORY_PARTS: canonicalParts,
    RECYCLE_BIN: canonicalRecycleBin,
    ACTIVE_COMPANY_ID: 'comp-001',
    _BOUND_COMPANY_ID: 'comp-001',
    WORKSPACE_DATA: undefined, // ELIMINATED DUAL SOURCE OF TRUTH
    saved_at: new Date().toISOString(),
    saved_at_ms: Date.now(),
    revision: (Number(store.revision) || 100) + 10
  };
  delete cleanStore.WORKSPACE_DATA;

  fs.writeFileSync(datastorePath, JSON.stringify(cleanStore, null, 2), 'utf8');
  console.log(`[SUCCESS] Wrote clean datastore to ${datastorePath}. Dual WORKSPACE_DATA buckets eliminated.`);

  // 9. INSERT/UPSERT INTO POSTGRESQL DATABASE
  console.log('Migrating clean records into PostgreSQL...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Companies
    for (const c of canonicalCompanies) {
      await client.query(`
        INSERT INTO companies (id, name, code, primary_color, secondary_color, logo_light_url, logo_dark_url, show_name_next_to_logo, logo_height, logo_width_pct, logo_alignment, logo_fit, designation_line_1, designation_line_2, designation_line_3, departments_json, kpi_targets_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          primary_color = EXCLUDED.primary_color,
          secondary_color = EXCLUDED.secondary_color,
          logo_light_url = EXCLUDED.logo_light_url,
          logo_dark_url = EXCLUDED.logo_dark_url,
          designation_line_1 = EXCLUDED.designation_line_1,
          designation_line_2 = EXCLUDED.designation_line_2,
          designation_line_3 = EXCLUDED.designation_line_3,
          departments_json = EXCLUDED.departments_json;
      `, [
        c.id, c.name, c.code, c.primary_color, c.secondary_color,
        c.logo_light_url, c.logo_dark_url, Boolean(c.show_name_next_to_logo),
        c.logo_height || 44, c.logo_width_pct || 85, c.logo_alignment || 'left', c.logo_fit || 'contain',
        c.designation_line_1, c.designation_line_2, c.designation_line_3,
        JSON.stringify(c.departments || []), JSON.stringify(c.kpi_targets || {}),
        c.created_at || new Date().toISOString()
      ]);
    }
    console.log(`  Inserted ${canonicalCompanies.length} companies into PostgreSQL.`);

    // Users
    for (const u of canonicalUsers) {
      await client.query(`
        INSERT INTO users (id, uid, email, name, password, role, access_scope, department, company_id, active, permissions_json, edit_permissions_json, delete_permissions_json, signature_name, signature_title, signature_font, signature_color, signature_style, signature_image_url, profile_image_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          password = EXCLUDED.password,
          role = EXCLUDED.role,
          company_id = EXCLUDED.company_id,
          active = EXCLUDED.active;
      `, [
        u.id, u.uid || u.id, u.email, u.name, u.password || 'Admin@123',
        u.role || 'Administrator', u.access_scope || 'Full System', u.department || 'Engineering',
        u.company_id || 'comp-001', u.active !== false,
        JSON.stringify(u.permissions || []), JSON.stringify(u.edit_permissions || []), JSON.stringify(u.delete_permissions || []),
        u.signature_name, u.signature_title, u.signature_font, u.signature_color, u.signature_style, u.signature_image_url, u.profile_image_url,
        u.created_at || new Date().toISOString()
      ]);
    }
    console.log(`  Inserted ${canonicalUsers.length} users into PostgreSQL.`);

    // Assets
    for (const a of canonicalAssets) {
      await client.query(`
        INSERT INTO assets (uid, company_id, asset_id, asset_name, section, department, status, criticality, serial_no, manufacturer, model_number, power_rating, supplier, installation_date, year_of_manufacture, warranty_expiry, technical_notes, category, location, service_provider, asset_value, photo_url, registered_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (uid) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          asset_id = EXCLUDED.asset_id,
          asset_name = EXCLUDED.asset_name,
          status = EXCLUDED.status,
          criticality = EXCLUDED.criticality;
      `, [
        a.uid, a.company_id, a.asset_id, a.asset_name,
        a.section, a.department, a.status || 'operational', a.criticality || 'A',
        a.serial_no, a.manufacturer, a.model_number, a.power_rating,
        a.supplier, a.installation_date, a.year_of_manufacture, a.warranty_expiry,
        a.technical_notes, a.category, a.location, a.service_provider,
        a.asset_value, a.photo_url, a.registered_at, a.created_at || new Date().toISOString()
      ]);
    }
    console.log(`  Inserted ${canonicalAssets.length} assets into PostgreSQL.`);

    // Breakdowns
    for (const b of canonicalBreakdowns) {
      await client.query(`
        INSERT INTO breakdowns (breakdown_id, company_id, asset_uid, asset_id, asset_name, incident_title, section, department, reported_dt, failure_category, severity, symptoms, technician_name, technician_phone, technician_email, status, notes, duration_mins, resolved_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (breakdown_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          status = EXCLUDED.status;
      `, [
        b.breakdown_id, b.company_id, b.asset_uid, b.asset_id, b.asset_name,
        b.incident_title, b.section, b.department, b.reported_dt,
        b.failure_category, b.severity, b.symptoms, b.technician_name,
        b.technician_phone, b.technician_email, b.status || 'Open',
        b.notes, b.duration_mins, b.resolved_at, b.created_at || new Date().toISOString()
      ]);
    }
    console.log(`  Inserted ${canonicalBreakdowns.length} breakdowns into PostgreSQL.`);

    // Maintenance Tasks
    for (const t of canonicalTasks) {
      await client.query(`
        INSERT INTO maintenance_tasks (task_id, company_id, asset_uid, asset_id, asset_name, maintenance_type, frequency, section, technician, task_title, task_description, due_date, status, priority, notes, completed_at, completion_notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (task_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          status = EXCLUDED.status;
      `, [
        t.task_id, t.company_id, t.asset_uid, t.asset_id, t.asset_name,
        t.maintenance_type, t.frequency, t.section, t.technician,
        t.task_title, t.task_description, t.due_date, t.status || 'Scheduled',
        t.priority || 'Medium', t.notes, t.completed_at, t.completion_notes,
        t.created_at || new Date().toISOString()
      ]);
    }
    console.log(`  Inserted ${canonicalTasks.length} maintenance tasks into PostgreSQL.`);

    // Inventory Parts
    for (const p of canonicalParts) {
      await client.query(`
        INSERT INTO inventory_parts (uid, company_id, part_name, sku, category, qty, min_qty, storage_location, unit_price, supplier, lead_time_days, is_critical, manufacturer, model_number, tech_specs, photo_url, doc_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (uid) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          qty = EXCLUDED.qty;
      `, [
        p.uid, p.company_id, p.part_name, p.sku, p.category,
        p.qty || 0, p.min_qty || 0, p.storage_location, p.unit_price,
        p.supplier, p.lead_time_days, Boolean(p.is_critical),
        p.manufacturer, p.model_number, p.tech_specs, p.photo_url, p.doc_url,
        p.created_at || new Date().toISOString()
      ]);
    }
    console.log(`  Inserted ${canonicalParts.length} inventory parts into PostgreSQL.`);

    // Recycle bin
    for (const r of canonicalRecycleBin) {
      const bid = r.bin_id || r.id;
      if (!bid) continue;
      await client.query(`
        INSERT INTO recycle_bin (id, company_id, entity_type, entity_label, primary_id, deleted_by_name, deleted_by_email, deleted_by_role, deleted_at, deleted_at_iso, record_data, summary)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING;
      `, [
        bid, r.company_id, r.entity_type, r.entity_label, r.primary_id || r.identifier || bid,
        r.deleted_by, r.deleted_by_email, r.deleted_by_role,
        r.deleted_at || new Date().toLocaleDateString(), r.deleted_at_iso || new Date().toISOString(),
        JSON.stringify(r.record || {}), r.summary || ''
      ]);
    }

    // System settings
    await client.query(`
      INSERT INTO system_settings (id, settings_json, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = EXCLUDED.updated_at;
    `, ['global', JSON.stringify(store.SYSTEM_SETTINGS || {}), new Date().toISOString()]);

    await client.query('COMMIT');
    console.log('--- POSTGRESQL TRANSACTION COMMITTED SUCCESSFULLY ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration transaction failed:', err);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
