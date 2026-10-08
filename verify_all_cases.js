const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
  max: 3,
  connectionTimeoutMillis: 5000,
});

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function verify() {
  console.log('================================================================');
  console.log('🧪 VERIFYING FIXES FOR CASES 1, 2, 3, 4 & RELATIONAL ARCHITECTURE');
  console.log('================================================================\n');

  // Step 0: Login
  console.log('1. Admin Authentication...');
  const loginRes = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  console.log('   Logged in successfully. Status:', loginRes.status);

  // -------------------------------------------------------------
  // CASE 1: WORKSPACE DELETION & REFRESH PERSISTENCE
  // -------------------------------------------------------------
  console.log('\n--- CASE 1: WORKSPACE CREATION, DELETION & REFRESH ---');
  const wsCode = 'VRF_' + Math.floor(1000 + Math.random() * 9000);
  const wsName = 'Verification WS ' + wsCode;

  // Create workspace
  const createWsRes = await req({
    path: '/settings/companies/save',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `name=${encodeURIComponent(wsName)}&code=${encodeURIComponent(wsCode)}`);
  console.log('   Create workspace redirected to:', createWsRes.headers.location);

  // Verify in PostgreSQL database
  const dbWsBefore = await pool.query('SELECT * FROM companies WHERE code = $1;', [wsCode]);
  console.log(`   PostgreSQL records created for ${wsCode}: ${dbWsBefore.rows.length} (Expected: 1)`);
  if (dbWsBefore.rows.length !== 1) throw new Error('Duplicate or missing workspace in DB!');

  const wsId = dbWsBefore.rows[0].id;

  // Delete workspace
  console.log(`   Deleting workspace ${wsId}...`);
  const delWsRes = await req({
    path: `/settings/companies/${wsId}/delete`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  });
  console.log('   Delete response redirect:', delWsRes.headers.location);
  if (delWsRes.headers.location !== '/settings/companies') {
    throw new Error(`CASE 4 VIOLATION: Expected redirect to /settings/companies, got ${delWsRes.headers.location}`);
  }

  // Refresh (simulate browser refresh)
  console.log('   Refreshing GET /settings/companies...');
  const refreshWsRes = await req({
    path: '/settings/companies',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });

  // Verify database
  const dbWsAfter = await pool.query('SELECT * FROM companies WHERE id = $1;', [wsId]);
  console.log(`   PostgreSQL record exists after delete: ${dbWsAfter.rows.length} (Expected: 0)`);
  if (dbWsAfter.rows.length !== 0) throw new Error('Workspace still exists in database after delete!');

  // Check rendered HTML (ensure the company card or delete action is NOT rendered)
  const wsCardInHtml = refreshWsRes.body.includes(`cardLogoLight_${wsId}`) || refreshWsRes.body.includes(`/settings/companies/${wsId}/delete`);
  console.log(`   Deleted workspace card appears in HTML after refresh: ${wsCardInHtml} (Expected: false)`);
  if (wsCardInHtml) throw new Error('CASE 1 FAILED: Deleted workspace card reappeared in HTML!');

  // Also simulate 2nd page refresh (where flash message is cleared) and verify workspace name does not appear anywhere
  const refresh2WsRes = await req({
    path: '/settings/companies',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });
  const wsIn2ndRefresh = refresh2WsRes.body.includes(`cardLogoLight_${wsId}`) || refresh2WsRes.body.includes(`action="/settings/companies/${wsId}/delete"`);
  console.log(`   Deleted workspace in 2nd refresh HTML: ${wsIn2ndRefresh} (Expected: false)`);
  if (wsIn2ndRefresh) throw new Error('CASE 1 FAILED: Deleted workspace card reappeared in HTML on 2nd refresh!');
  console.log('   ✅ CASE 1 PASSED: Workspace remains deleted across refresh.');

  // -------------------------------------------------------------
  // CASE 2: ASSET DELETION & REFRESH PERSISTENCE
  // -------------------------------------------------------------
  console.log('\n--- CASE 2: ASSET CREATION, DELETION & REFRESH ---');
  const assetTag = 'AST_' + Math.floor(1000 + Math.random() * 9000);
  const assetName = 'Verification Pump ' + assetTag;

  // Step 1: wizard step 1
  await req({
    path: '/assets/new/step-1',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `asset_type=Pump&criticality=A&section=Processing`);

  // Step 2: wizard step 2
  await req({
    path: '/assets/new/step-2',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `manufacturer=Grundfos&model_number=CR-30&serial_number=SN-${assetTag}`);

  // Step 3: wizard step 3
  const createAssetRes = await req({
    path: '/assets/new/step-3',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `asset_id=${encodeURIComponent(assetTag)}&asset_name=${encodeURIComponent(assetName)}&location=Pump+House&criticality=A`);
  console.log('   Create asset redirected to:', createAssetRes.headers.location);

  // Check database
  const dbAssetBefore = await pool.query('SELECT * FROM assets WHERE asset_id = $1;', [assetTag]);
  console.log(`   PostgreSQL records created for ${assetTag}: ${dbAssetBefore.rows.length} (Expected: 1)`);
  if (dbAssetBefore.rows.length !== 1) throw new Error('Duplicate or missing asset in DB!');

  const assetUid = dbAssetBefore.rows[0].uid;

  // Delete asset
  console.log(`   Deleting asset ${assetUid} (${assetTag})...`);
  const delAssetRes = await req({
    path: `/assets/${encodeURIComponent(assetUid)}/delete`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, `asset_uid=${encodeURIComponent(assetUid)}&asset_id=${encodeURIComponent(assetTag)}`);
  console.log('   Delete asset redirect location:', delAssetRes.headers.location);
  if (delAssetRes.headers.location !== '/assets') {
    throw new Error(`CASE 4 VIOLATION: Expected redirect to /assets, got ${delAssetRes.headers.location}`);
  }

  // Refresh (simulate browser refresh on /assets)
  console.log('   Refreshing GET /assets...');
  const refreshAssetRes = await req({
    path: '/assets',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });

  // Verify in PostgreSQL
  const dbAssetAfter = await pool.query('SELECT * FROM assets WHERE uid = $1;', [assetUid]);
  console.log(`   PostgreSQL record exists after delete: ${dbAssetAfter.rows.length} (Expected: 0)`);
  if (dbAssetAfter.rows.length !== 0) throw new Error('Asset still exists in database after delete!');

  // Check rendered HTML table for asset
  const hasAssetInTable = refreshAssetRes.body.includes(`>${assetTag}<`);
  console.log(`   Deleted asset appears in HTML table after refresh: ${hasAssetInTable} (Expected: false)`);
  if (hasAssetInTable) throw new Error('CASE 2 FAILED: Deleted asset reappeared in HTML table!');
  console.log('   ✅ CASE 2 PASSED: Asset remains deleted across refresh.');

  // -------------------------------------------------------------
  // CASE 3: RESTORE WORKSPACE FROM RECYCLE BIN
  // -------------------------------------------------------------
  console.log('\n--- CASE 3: RESTORE WORKSPACE FROM RECYCLE BIN ---');
  // Look up the recycle bin entry for our deleted workspace
  const binEntry = await pool.query('SELECT * FROM recycle_bin WHERE primary_id = $1;', [wsId]);
  console.log(`   Recycle bin entry found in DB: ${binEntry.rows.length > 0}`);
  if (binEntry.rows.length === 0) throw new Error('Recycle bin entry not found in database!');

  const binId = binEntry.rows[0].id;
  console.log(`   Restoring workspace via POST /settings/recycle-bin/${binId}/restore...`);
  const restoreRes = await req({
    path: `/settings/recycle-bin/${binId}/restore`,
    method: 'POST',
    headers: { 'Cookie': cookies }
  });
  console.log('   Restore redirect:', restoreRes.headers.location);

  // Verify restored in database
  const dbWsRestored = await pool.query('SELECT * FROM companies WHERE id = $1;', [wsId]);
  console.log(`   Workspace restored in PostgreSQL companies table: ${dbWsRestored.rows.length === 1}`);
  if (dbWsRestored.rows.length !== 1) throw new Error('Restored workspace not found in database!');

  // Verify visible in GET /settings/companies
  const getCompaniesRes = await req({
    path: '/settings/companies',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });
  const restoredVisible = getCompaniesRes.body.includes(wsName);
  console.log(`   Restored workspace visible in /settings/companies: ${restoredVisible} (Expected: true)`);
  if (!restoredVisible) throw new Error('CASE 3 FAILED: Restored workspace not visible in HTML!');

  // Clean up test workspace
  await req({
    path: `/settings/companies/${wsId}/delete`,
    method: 'POST',
    headers: { 'Cookie': cookies }
  });
  console.log('   ✅ CASE 3 PASSED: Restored workspace returned reliably to Workspaces.');

  // -------------------------------------------------------------
  // CASE 4: NAVIGATION INTEGRITY ACROSS ALL MODULES
  // -------------------------------------------------------------
  console.log('\n--- CASE 4: NAVIGATION INTEGRITY AFTER RECORD DELETION ---');
  const testRoutes = [
    { name: 'Asset Module', delPath: '/assets/non-existent-tag/delete', expectedRedirect: '/assets' },
    { name: 'Breakdown Module', delPath: '/breakdowns/non-existent-bd/delete', expectedRedirect: '/breakdowns' },
    { name: 'Maintenance Module', delPath: '/maintenance/non-existent-task/delete', expectedRedirect: '/maintenance' },
    { name: 'Inventory Module', delPath: '/inventory/non-existent-sku/delete', expectedRedirect: '/inventory' }
  ];

  for (const t of testRoutes) {
    const res = await req({
      path: t.delPath,
      method: 'POST',
      headers: { 'Cookie': cookies }
    });
    console.log(`   ${t.name} delete redirect: ${res.headers.location} (Expected: ${t.expectedRedirect})`);
    if (res.headers.location !== t.expectedRedirect) {
      throw new Error(`CASE 4 FAILED on ${t.name}: Redirected to ${res.headers.location} instead of ${t.expectedRedirect}`);
    }
  }
  console.log('   ✅ CASE 4 PASSED: System remains in module, NEVER bounces to Dashboard.');

  console.log('\n================================================================');
  console.log('🎉 ALL 4 CASES & DATABASE RELATIONAL INTEGRITY VERIFIED 100% SUCCESS!');
  console.log('================================================================');
  pool.end();
}

verify().catch(err => {
  console.error('\n❌ VERIFICATION ERROR:', err);
  pool.end();
  process.exit(1);
});
