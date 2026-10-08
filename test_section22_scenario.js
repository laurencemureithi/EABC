const http = require('http');
const fs = require('fs');
const assert = require('assert');

const BASE_URL = 'http://127.0.0.1:3000';

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/', BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Scenario-Runner',
        ...(options.headers || {})
      }
    };

    if (postData) {
      if (typeof postData === 'object' && !(postData instanceof Buffer)) {
        if (reqOptions.headers['Content-Type'] === 'application/x-www-form-urlencoded') {
          postData = new URLSearchParams(postData).toString();
        } else {
          reqOptions.headers['Content-Type'] = 'application/json';
          postData = JSON.stringify(postData);
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

function assertRedirect(res, message = 'Should redirect') {
  assert.ok(res.statusCode === 302 || res.statusCode === 303, `${message}: expected 302 or 303, got ${res.statusCode}`);
}

async function runScenario() {
  console.log('================================================================');
  console.log('🧪 EXECUTING FULL SECTION 22 END-TO-END VERIFICATION SCENARIO');
  console.log('================================================================\n');

  let adminSession = {};
  let wsA = null;
  let wsB = null;
  let assetA = null;
  let customRole = null;
  let restrictedUser = null;

  // STEP 1: Login as administrator
  console.log('Step 1: Login as Administrator...');
  const loginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: 'opsloom.ke@gmail.com',
    password: 'Admin@123'
  });
  assertRedirect(loginRes, 'Admin login redirect');
  adminSession = parseCookies(loginRes);
  assert.ok(adminSession.opsloom_user, 'Session cookie issued');
  console.log('   ✅ Step 1 Passed: Admin logged in successfully.\n');

  // STEP 2: Create Workspace A
  console.log('Step 2: Create Workspace A...');
  const wsACode = `ALPH_${Date.now().toString().slice(-4)}`;
  const createWsARes = await request({
    path: '/settings/companies/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    name: 'Alpha Manufacturing',
    code: wsACode,
    primary_color: '#1e40af',
    secondary_color: '#3b82f6'
  });
  assertRedirect(createWsARes);
  let datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  wsA = datastore.COMPANIES.find(c => c.code === wsACode);
  assert.ok(wsA, 'Workspace A created');
  console.log(`   ✅ Step 2 Passed: Workspace A created (ID: ${wsA.id}, Name: ${wsA.name})\n`);

  // STEP 3: Configure Workspace A branding
  console.log('Step 3: Configure Workspace A Branding...');
  const updateWsABranding = await request({
    path: '/settings/companies/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    id: wsA.id,
    name: 'Alpha Manufacturing Group',
    code: wsACode,
    primary_color: '#1d4ed8',
    secondary_color: '#60a5fa'
  });
  assertRedirect(updateWsABranding);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  wsA = datastore.COMPANIES.find(c => c.id === wsA.id);
  assert.strictEqual(wsA.name, 'Alpha Manufacturing Group');
  console.log('   ✅ Step 3 Passed: Workspace A branding saved.\n');

  // STEP 4: Create Workspace B
  console.log('Step 4: Create Workspace B...');
  const wsBCode = `BETA_${Date.now().toString().slice(-4)}`;
  const createWsBRes = await request({
    path: '/settings/companies/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    name: 'Beta Logistics',
    code: wsBCode,
    primary_color: '#047857',
    secondary_color: '#10b981'
  });
  assertRedirect(createWsBRes);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  wsB = datastore.COMPANIES.find(c => c.code === wsBCode);
  assert.ok(wsB, 'Workspace B created');
  console.log(`   ✅ Step 4 Passed: Workspace B created (ID: ${wsB.id}, Name: ${wsB.name})\n`);

  // STEP 5: Configure Workspace B branding
  console.log('Step 5: Configure Workspace B Branding...');
  const updateWsBBranding = await request({
    path: '/settings/companies/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    id: wsB.id,
    name: 'Beta Logistics East Africa',
    code: wsBCode,
    primary_color: '#065f46',
    secondary_color: '#34d399'
  });
  assertRedirect(updateWsBBranding);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  wsB = datastore.COMPANIES.find(c => c.id === wsB.id);
  assert.strictEqual(wsB.name, 'Beta Logistics East Africa');
  console.log('   ✅ Step 5 Passed: Workspace B branding saved.\n');

  // STEP 6: Switch between A and B
  console.log('Step 6: Switch Between A and B...');
  const switchBRes = await request({
    path: `/set-company?company_id=${wsB.id}`,
    headers: { Cookie: cookieHeader(adminSession) }
  });
  assertRedirect(switchBRes);
  adminSession = { ...adminSession, ...parseCookies(switchBRes), opsloom_ws_id: wsB.id };

  const switchARes = await request({
    path: `/set-company?company_id=${wsA.id}`,
    headers: { Cookie: cookieHeader(adminSession) }
  });
  assertRedirect(switchARes);
  adminSession = { ...adminSession, ...parseCookies(switchARes), opsloom_ws_id: wsA.id };
  console.log(`   ✅ Step 6 Passed: Context switched to Workspace A (${wsA.id}).\n`);

  // STEP 7: Create an asset in A
  console.log('Step 7: Create Asset in Workspace A...');
  const assetTag = `AST-A-${Date.now().toString().slice(-4)}`;
  const createAssetRes = await request({
    path: '/assets/new/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    asset_name: 'Conveyor Line Alpha-1',
    asset_id: assetTag,
    section: 'Packaging',
    location: 'Bay 1',
    criticality: 'A'
  });
  assertRedirect(createAssetRes);
  console.log('   ✅ Step 7 Passed: Asset created in Workspace A.\n');

  // STEP 8: Refresh
  console.log('Step 8 & 9: Refresh and Confirm Asset Remains...');
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  assetA = (datastore.ASSETS || datastore.WORKSPACE_DATA?.[wsA.id]?.ASSETS || []).find(a => a.asset_id === assetTag);
  assert.ok(assetA, 'Asset remains after refresh');
  console.log(`   ✅ Step 8 & 9 Passed: Asset "${assetA.asset_name}" verified in persistent store.\n`);

  // STEP 10: Edit the asset
  console.log('Step 10: Edit the Asset...');
  const editAssetRes = await request({
    path: `/assets/${assetA.uid}/edit`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    asset_name: 'Conveyor Line Alpha-1 (Upgraded)',
    asset_id: assetTag,
    section: 'Packaging',
    location: 'Bay 1 - Station B',
    criticality: 'A'
  });
  assertRedirect(editAssetRes);
  console.log('   ✅ Step 10 Passed: Asset edit submitted.\n');

  // STEP 11 & 12: Refresh & confirm edit remains
  console.log('Step 11 & 12: Refresh and Confirm Edit Remains...');
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  assetA = (datastore.ASSETS || datastore.WORKSPACE_DATA?.[wsA.id]?.ASSETS || []).find(a => a.uid === assetA.uid);
  assert.strictEqual(assetA.asset_name, 'Conveyor Line Alpha-1 (Upgraded)');
  assert.strictEqual(assetA.location, 'Bay 1 - Station B');
  console.log('   ✅ Step 11 & 12 Passed: Edited values verified in persistent store.\n');

  // STEP 13: Delete asset
  console.log('Step 13: Delete Asset...');
  const delAssetRes = await request({
    path: `/assets/${assetA.uid}/delete`,
    headers: { Cookie: cookieHeader(adminSession) }
  });
  assertRedirect(delAssetRes);
  console.log('   ✅ Step 13 Passed: Asset deleted.\n');

  // STEP 14 & 15: Refresh & confirm it remains deleted
  console.log('Step 14 & 15: Refresh and Confirm Asset Remains Deleted...');
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const assetStillInA = (datastore.ASSETS || datastore.WORKSPACE_DATA?.[wsA.id]?.ASSETS || []).some(a => a.uid === assetA.uid);
  assert.strictEqual(assetStillInA, false, 'Asset must not be in active workspace assets');
  console.log('   ✅ Step 14 & 15 Passed: Asset remains safely deleted from active view.\n');

  // STEP 16: Create a role
  console.log('Step 16 & 17: Create & Save Role...');
  const roleName = `Line Inspector ${Date.now().toString().slice(-4)}`;
  const saveRoleRes = await request({
    path: '/settings/admin-users/roles/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    name: roleName,
    access_scope: 'Department',
    permissions: ['dashboard', 'assets', 'messages'],
    edit_permissions: ['assets'],
    delete_permissions: []
  });
  assertRedirect(saveRoleRes);
  console.log('   ✅ Step 16 & 17 Passed: Role saved.\n');

  // STEP 18 & 19: Refresh & confirm role exists
  console.log('Step 18 & 19: Refresh and Confirm Role Exists...');
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  customRole = (datastore.CUSTOM_ROLES || []).find(r => r.name === roleName);
  assert.ok(customRole, 'Custom role must exist in persistent store');
  assert.ok(customRole.modules.includes('assets'), 'Role includes assets module');
  console.log(`   ✅ Step 18 & 19 Passed: Role "${customRole.name}" confirmed.\n`);

  // STEP 20 & 21: Create restricted user & assign role
  console.log('Step 20 & 21: Create Restricted User & Assign Role...');
  const restrictedUserEmail = `inspector.${Date.now()}@alpha.com`;
  const createUserRes = await request({
    path: '/settings/admin-users/create',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    name: 'Sam Inspector',
    email: restrictedUserEmail,
    password: 'InspectorPassword@123',
    role: customRole.name,
    access_scope: 'Assigned Workspace',
    company_id: wsA.id,
    active: '1',
    permissions: ['dashboard', 'assets', 'messages']
  });
  assertRedirect(createUserRes);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  restrictedUser = datastore.ADMIN_USERS.find(u => u.email === restrictedUserEmail);
  assert.ok(restrictedUser, 'Restricted user created');
  assert.strictEqual(restrictedUser.role, customRole.name);
  console.log(`   ✅ Step 20 & 21 Passed: User "${restrictedUser.name}" created with role "${restrictedUser.role}".\n`);

  // STEP 22: Log out
  console.log('Step 22: Log Out Administrator...');
  const logoutRes = await request({
    path: '/logout',
    headers: { Cookie: cookieHeader(adminSession) }
  });
  assertRedirect(logoutRes);
  console.log('   ✅ Step 22 Passed: Admin logged out.\n');

  // STEP 23: Log in as restricted user
  console.log('Step 23: Log In as Restricted User...');
  const inspectorLoginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: restrictedUserEmail,
    password: 'InspectorPassword@123'
  });
  assertRedirect(inspectorLoginRes);
  const inspectorSession = parseCookies(inspectorLoginRes);
  assert.ok(inspectorSession.opsloom_user, 'Inspector session cookie issued');
  console.log('   ✅ Step 23 Passed: Restricted user authenticated.\n');

  // STEP 24: Confirm allowed functions work
  console.log('Step 24: Confirm Allowed Functions Work...');
  const allowedRes = await request({
    path: '/assets',
    headers: { Cookie: cookieHeader(inspectorSession) }
  });
  assert.strictEqual(allowedRes.statusCode, 200, 'Inspector can view assets');
  console.log('   ✅ Step 24 Passed: Allowed function (/assets) accessed successfully (HTTP 200).\n');

  // STEP 25: Confirm unauthorized functions are blocked
  console.log('Step 25: Confirm Unauthorized Functions are Blocked...');
  const blockedRes = await request({
    path: '/settings/admin-users',
    headers: { Cookie: cookieHeader(inspectorSession) }
  });
  // Should redirect or return 403 Forbidden
  assert.ok(blockedRes.statusCode === 302 || blockedRes.statusCode === 303 || blockedRes.statusCode === 403, 'Unauthorized route must be blocked');
  console.log(`   ✅ Step 25 Passed: Unauthorized route blocked with status ${blockedRes.statusCode}.\n`);

  // STEP 26 & 27: Create real event -> confirm notification appears
  console.log('Step 26 & 27: Trigger Real Event & Confirm Event Notification...');
  // Log in as admin again to trigger event
  const reAdminLogin = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: 'opsloom.ke@gmail.com',
    password: 'Admin@123'
  });
  adminSession = { ...adminSession, ...parseCookies(reAdminLogin), opsloom_ws_id: wsA.id };
  
  // Create an asset and schedule PM
  const evAssetTag = `EV-AST-${Date.now().toString().slice(-4)}`;
  await request({
    path: '/assets/new/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    asset_name: 'Alpha Reactor Unit',
    asset_id: evAssetTag,
    section: 'Production'
  });

  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const evAsset = (datastore.ASSETS || datastore.WORKSPACE_DATA?.[wsA.id]?.ASSETS || []).find(a => a.asset_id === evAssetTag);

  await request({
    path: '/maintenance/schedule/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    asset_uid: evAsset.uid,
    task_description: 'Annual Pressure Valve Recalibration',
    technician: 'David Kimani',
    frequency: 'Annual'
  });

  // Verify notification was created
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const notifs = datastore.SYSTEM_NOTIFICATIONS || [];
  const pmNotif = notifs.find(n => n.title?.includes('PM') || n.message?.includes('Recalibration') || n.message?.includes('Task'));
  assert.ok(pmNotif, 'Real event notification must exist');
  console.log(`   ✅ Step 26 & 27 Passed: Event notification "${pmNotif.title}" generated from PM scheduling.\n`);

  // STEP 28: Send an internal message
  console.log('Step 28: Send Internal Message...');
  const msgSubject = `Safety Inspection Order #${Date.now().toString().slice(-4)}`;
  const sendMsgRes = await request({
    path: '/settings/messages/send',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(adminSession)
    }
  }, {
    recipient_emails: restrictedUserEmail,
    subject: msgSubject,
    body: 'Please carry out full vibration analysis on Reactor Unit 1.'
  });
  assertRedirect(sendMsgRes);
  console.log('   ✅ Step 28 Passed: Internal message sent.\n');

  // STEP 29 & 30: Log in as recipient & confirm message appears
  console.log('Step 29 & 30: Log In as Recipient and Confirm Message Received...');
  const recipientLogin = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: restrictedUserEmail,
    password: 'InspectorPassword@123'
  });
  const recipientSession = parseCookies(recipientLogin);
  
  const inboxRes = await request({
    path: '/settings/messages?folder=inbox',
    headers: { Cookie: cookieHeader(recipientSession) }
  });
  if (inboxRes.statusCode !== 200) {
    console.log('DEBUG: inboxRes status:', inboxRes.statusCode, 'Location:', inboxRes.headers.location, 'Cookies sent:', cookieHeader(recipientSession));
  }
  assert.strictEqual(inboxRes.statusCode, 200);
  assert.ok(inboxRes.body.includes(msgSubject), 'Recipient inbox must contain message');
  console.log('   ✅ Step 29 & 30 Passed: Recipient received message in inbox.\n');

  // STEP 31 & 32: Generate report from Workspace A -> confirm A branding
  console.log('Step 31 & 32: Report from Workspace A & Confirm Branding...');
  const genReportARes = await request({
    path: '/reports/generate/step3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader({ ...adminSession, opsloom_ws_id: wsA.id })
    }
  }, {
    report_title: 'Workspace A Operations Report',
    category: 'strategic_roi'
  });
  assertRedirect(genReportARes);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const reportA = (datastore.WORKSPACE_DATA?.[wsA.id]?.REPORT_EXPORTS || datastore.REPORT_EXPORTS || [])[0];
  assert.ok(reportA, 'Report A must be created');

  const repARes = await request({
    path: `/reports/${reportA.id}/print`,
    headers: { Cookie: cookieHeader({ ...adminSession, opsloom_ws_id: wsA.id }) }
  });
  assert.strictEqual(repARes.statusCode, 200);
  assert.ok(repARes.body.includes('Alpha Manufacturing') || repARes.body.includes(wsACode), 'Report must display Workspace A identity');
  console.log('   ✅ Step 31 & 32 Passed: Workspace A branding confirmed in report.\n');

  // STEP 33, 34, 35: Switch to Workspace B -> generate report -> confirm B branding
  console.log('Step 33, 34, 35: Switch to Workspace B and Confirm Branding in Report...');
  const switchBAgain = await request({
    path: `/set-company?company_id=${wsB.id}`,
    headers: { Cookie: cookieHeader(adminSession) }
  });
  assertRedirect(switchBAgain);

  const genReportBRes = await request({
    path: '/reports/generate/step3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader({ ...adminSession, opsloom_ws_id: wsB.id })
    }
  }, {
    report_title: 'Workspace B Operations Report',
    category: 'strategic_roi'
  });
  assertRedirect(genReportBRes);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const reportB = (datastore.WORKSPACE_DATA?.[wsB.id]?.REPORT_EXPORTS || datastore.REPORT_EXPORTS || [])[0];
  assert.ok(reportB, 'Report B must be created');

  const repBRes = await request({
    path: `/reports/${reportB.id}/print`,
    headers: { Cookie: cookieHeader({ ...adminSession, opsloom_ws_id: wsB.id }) }
  });
  assert.strictEqual(repBRes.statusCode, 200);
  assert.ok(repBRes.body.includes('Beta Logistics') || repBRes.body.includes(wsBCode), 'Report must display Workspace B identity');
  console.log('   ✅ Step 33, 34 & 35 Passed: Workspace B branding confirmed in report.\n');

  // STEP 36: Upload a file (test document)
  console.log('Step 36, 37, 38: File Upload, Refresh & Persistence...');
  const uploadPayload = JSON.stringify({
    notes: 'Safety inspection manual uploaded',
    upload_date: new Date().toISOString()
  });
  const uploadDocRes = await request({
    path: `/assets/${evAsset.uid}/documents/upload`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader({ ...adminSession, opsloom_ws_id: wsA.id })
    }
  }, {
    doc_title: 'Reactor Safety Manual',
    doc_type: 'Manual',
    notes: 'Approved standard operating procedure.'
  });
  assertRedirect(uploadDocRes);
  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const docs = (datastore.ASSET_DOCUMENTS || datastore.WORKSPACE_DATA?.[wsA.id]?.ASSET_DOCUMENTS || []);
  assert.ok(docs.length > 0, 'Document must be persisted');
  console.log(`   ✅ Step 36, 37 & 38 Passed: Document "${docs[0].title || docs[0].name}" persisted and verified.\n`);

  // STEP 39, 40, 41: Log out, log back in, confirm all persisted info remains
  console.log('Step 39, 40, 41: Logout, Re-Login & Verify Full System State Persistence...');
  await request({ path: '/logout', headers: { Cookie: cookieHeader(adminSession) } });
  
  const finalLogin = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: 'opsloom.ke@gmail.com',
    password: 'Admin@123'
  });
  assertRedirect(finalLogin);
  const finalSession = parseCookies(finalLogin);
  
  const finalDash = await request({
    path: '/dashboard',
    headers: { Cookie: cookieHeader(finalSession) }
  });
  assert.strictEqual(finalDash.statusCode, 200);

  datastore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  assert.ok(datastore.COMPANIES.some(c => c.id === wsA.id), 'Workspace A persisted');
  assert.ok(datastore.COMPANIES.some(c => c.id === wsB.id), 'Workspace B persisted');
  assert.ok(datastore.ADMIN_USERS.some(u => u.email === restrictedUserEmail), 'User persisted');
  assert.ok(datastore.CUSTOM_ROLES.some(r => r.name === roleName), 'Role persisted');
  console.log('   ✅ Step 39, 40 & 41 Passed: Full system state intact and verified.\n');

  console.log('================================================================');
  console.log('🏆 ALL 41 STEPS OF THE SECTION 22 VERIFICATION PASSED 100%! 🏆');
  console.log('================================================================');
}

runScenario().catch(err => {
  console.error('\n❌ SCENARIO FAILED:', err);
  process.exit(1);
});
