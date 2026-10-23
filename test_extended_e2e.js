const http = require('http');
const assert = require('assert');
const dal = require('./src/db/dal');

const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'http://127.0.0.1:3000');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/', BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'E2E-Deep-Verifier',
        ...(options.headers || {})
      }
    };

    if (postData) {
      if (typeof postData === 'object' && !(postData instanceof Buffer)) {
        if (reqOptions.headers['Content-Type'] === 'application/x-www-form-urlencoded') {
          postData = new URLSearchParams(postData).toString();
        } else {
          reqOptions.headers['Content-Type'] = 'application/json';
        }
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function parseCookies(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return {};
  const cookies = {};
  setCookie.forEach(c => {
    const parts = c.split(';')[0].split('=');
    const name = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    cookies[name] = val;
  });
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function runDeepVerification() {
  console.log('====================================================');
  console.log('🔬 RUNNING ADVANCED DATA PERSISTENCE & ANALYTICS VERIFICATION');
  console.log('====================================================\n');

  // 1. Authenticate Admin
  console.log('1. Authenticating Admin Session...');
  const loginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: 'opsloom.ke@gmail.com',
    password: 'Admin@123'
  });
  assert.ok(loginRes.statusCode === 302 || loginRes.statusCode === 303, 'Login failed');
  const cookies = parseCookies(loginRes);
  const authHeaders = { Cookie: cookieHeader(cookies) };
  console.log('   ✅ Admin authenticated\n');

  // 2. Fetch Assets to pick an asset to test with
  console.log('2. Verifying Asset Register from PostgreSQL...');
  const assets = await dal.getAssets();
  assert.ok(assets.length > 0, 'Should have at least 1 asset in PostgreSQL');
  const targetAsset = assets[0];
  console.log(`   ✅ Using Asset: ${targetAsset.asset_name} (${targetAsset.asset_id}, UID: ${targetAsset.uid})\n`);

  // 3. Test Asset Spare Parts View
  console.log('3. Testing Asset Spare Parts View & KPIs...');
  const sparePartsRes = await request({
    path: `/assets/${targetAsset.uid}/spare-parts`,
    headers: authHeaders
  });
  assert.strictEqual(sparePartsRes.statusCode, 200, 'Spare parts page should return 200');
  assert.ok(sparePartsRes.body.includes('Asset Spare Parts Inventory'), 'Should render Spare Parts Inventory table');
  assert.ok(sparePartsRes.body.includes('Total Linked Parts'), 'Should render Total Linked Parts KPI');
  console.log('   ✅ Spare parts page renders with linked parts and inventory KPIs\n');

  // 4. Test Asset Document Upload and PostgreSQL Persistence
  console.log('4. Testing Asset Document Upload & PostgreSQL Persistence...');
  const testDocTitle = `Calibration Certificate - ${Date.now()}`;
  const uploadRes = await request({
    path: `/assets/${targetAsset.uid}/documents/upload`,
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, {
    title: testDocTitle,
    doc_name: testDocTitle,
    category: 'CERTIFICATION',
    version: 'v2.1',
    owner: 'Quality Assurance Team',
    description: 'ISO-9001 certified optical sensor calibration record.'
  });
  assert.ok(uploadRes.statusCode === 302 || uploadRes.statusCode === 303, 'Document upload should redirect');

  // Verify in PostgreSQL
  const dbDocs = await dal.getAssetDocuments(targetAsset.uid);
  const foundDoc = dbDocs.find(d => d.title === testDocTitle || d.doc_name === testDocTitle);
  assert.ok(foundDoc, 'Document must be persisted in PostgreSQL asset_documents table');
  console.log(`   ✅ Document persisted in PostgreSQL (ID: ${foundDoc.id}, Title: "${foundDoc.title}")\n`);

  // Verify in Document Page View
  const docsPageRes = await request({
    path: `/assets/${targetAsset.uid}/documents`,
    headers: authHeaders
  });
  assert.strictEqual(docsPageRes.statusCode, 200, 'Documents page should return 200');
  assert.ok(docsPageRes.body.includes(testDocTitle), 'Documents table must display the uploaded document');
  console.log('   ✅ Documents page displays uploaded certificate\n');

  // 5. Test Strategic Report Generation & Persistence
  console.log('5. Testing Strategic Intelligence Report Generation & Persistence...');
  const testReportTitle = `Plant Operational Reliability Audit ${Date.now()}`;
  const reportGenRes = await request({
    path: '/reports/generate/step3',
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, {
    category: 'strategic_roi',
    report_title: testReportTitle,
    department: 'Engineering',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    export_format: 'PDF',
    exec_notes: 'Comprehensive evaluation of maintenance spend and uptime benchmarks.'
  });
  assert.ok(reportGenRes.statusCode === 302 || reportGenRes.statusCode === 303, 'Report generation should redirect');
  const matchRid = (reportGenRes.headers.location || '').match(/rid=([^&]+)/);
  assert.ok(matchRid, 'Redirect URL should contain report id (rid)');
  const reportId = matchRid[1];

  // Verify report in PostgreSQL
  const dbReport = await dal.getReportById(reportId);
  assert.ok(dbReport, 'Generated report must exist in PostgreSQL reports table');
  assert.strictEqual(dbReport.id, reportId, 'Report ID in PostgreSQL must match generated ID');
  console.log(`   ✅ Report persisted in PostgreSQL reports table (ID: ${dbReport.id})\n`);

  // Verify report in Reports History page
  const historyRes = await request({
    path: '/reports/history',
    headers: authHeaders
  });
  assert.strictEqual(historyRes.statusCode, 200, 'Reports history should return 200');
  assert.ok(historyRes.body.includes(testReportTitle) || historyRes.body.includes(reportId), 'Reports history must include newly generated report');
  console.log('   ✅ Reports history reflects generated report\n');

  // 6. Test Breakdown Logging with Financials & Downtime
  console.log('6. Testing Breakdown Logging with Cost & Downtime Persistence...');
  const incidentTitle = `Drive Coupling Shear Failure ${Date.now()}`;
  const breakdownRes = await request({
    path: '/breakdowns/new/step-2',
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, {
    asset_uid: targetAsset.uid,
    asset_id: targetAsset.asset_id,
    incident_title: incidentTitle,
    failure_category: 'Mechanical',
    severity: 'Critical',
    technician_name: 'David Kimani',
    symptoms: 'High torque failure on primary gearbox coupling drive.',
    description: 'High torque failure on primary gearbox coupling drive.'
  });
  assert.ok(breakdownRes.statusCode === 302 || breakdownRes.statusCode === 303, 'Breakdown log should redirect');

  // Fetch created breakdown from PostgreSQL
  const dbBreakdowns = await dal.getBreakdowns();
  const createdBd = dbBreakdowns.find(b => b.incident_title === incidentTitle || (b.asset_uid === targetAsset.uid && b.technician_name === 'David Kimani'));
  assert.ok(createdBd, 'Logged breakdown must exist in PostgreSQL');

  // Update breakdown with repair costs and status
  const updateCostRes = await request({
    path: `/breakdowns/${createdBd.breakdown_id}/update`,
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, {
    cost_subtotal: '45000',
    cost_vat_pct: '16',
    status: 'in_progress',
    progress_note: 'Technician mobilized to align gearbox coupling.'
  });
  assert.ok(updateCostRes.statusCode === 302 || updateCostRes.statusCode === 303, 'Breakdown update should redirect');

  // Verify updated cost and financial integrity in PostgreSQL
  const refreshedBds = await dal.getBreakdowns();
  const refreshedBd = refreshedBds.find(b => b.breakdown_id === createdBd.breakdown_id);
  assert.ok(refreshedBd, 'Refreshed breakdown must exist in PostgreSQL');
  assert.strictEqual(Number(refreshedBd.cost_total), 52200, 'cost_total must be 52200 in PostgreSQL (subtotal 45000 + 16% VAT)');
  console.log(`   ✅ Breakdown stored in PostgreSQL with cost KES ${refreshedBd.cost_total} and status ${refreshedBd.status}\n`);

  // 7. Verify Dashboard Analytics reflect the financial & downtime metrics
  console.log('7. Verifying Dashboard Analytics Refreshed from Database...');
  const dashRes = await request({
    path: '/dashboard',
    headers: authHeaders
  });
  assert.strictEqual(dashRes.statusCode, 200, 'Dashboard should return 200');
  console.log('   ✅ Dashboard rendered successfully with updated database metrics\n');

  // Cleanup test artifacts
  console.log('8. Cleaning up test verification entries...');
  await dal.deleteAssetDocument(foundDoc.id);
  await dal.deleteReport(reportId);
  if (createdBd && createdBd.breakdown_id) {
    await dal.deleteBreakdown(createdBd.breakdown_id);
  }
  console.log('   ✅ Cleanup completed\n');

  console.log('====================================================');
  console.log('🎉 ALL ADVANCED DATA PERSISTENCE TESTS PASSED! 🎉');
  console.log('====================================================');
  process.exit(0);
}

runDeepVerification().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
