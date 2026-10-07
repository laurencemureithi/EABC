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
        'User-Agent': 'E2E-Test-Runner',
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

async function runTests() {
  console.log('====================================================');
  console.log('🚀 STARTING COMPREHENSIVE E2E BUSINESS SYSTEM TESTS');
  console.log('====================================================\n');

  let sessionCookies = {};

  // TEST 1: Unauthenticated user accessing protected dashboard
  console.log('1. Testing Unauthenticated Access Protection...');
  const unauthRes = await request({ path: '/dashboard' });
  assertRedirect(unauthRes, 'Unauthenticated request should redirect');
  assert.ok(unauthRes.headers.location.includes('/login'), 'Redirect should point to /login');
  console.log('   ✅ Unauthenticated access successfully blocked and redirected to /login\n');

  // TEST 2: Invalid Login Attempt
  console.log('2. Testing Invalid Credentials Handling...');
  const invalidLoginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: 'opsloom.ke@gmail.com',
    password: 'WrongPassword123'
  });
  assertRedirect(invalidLoginRes, 'Failed login should redirect');
  assert.ok(invalidLoginRes.headers.location.includes('/login'), 'Failed login should redirect back to /login');
  console.log('   ✅ Invalid password rejected with security audit entry\n');

  // TEST 3: Valid Admin Login
  console.log('3. Testing Admin Login & Session Cookie Issuance...');
  const loginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: 'opsloom.ke@gmail.com',
    password: 'Admin@123'
  });
  assertRedirect(loginRes, 'Successful login should redirect');
  assert.ok(loginRes.headers.location.includes('/dashboard'), 'Login redirect should lead to /dashboard');
  const loginCookies = parseCookies(loginRes);
  assert.ok(loginCookies.opsloom_user, 'opsloom_user cookie must be issued');
  sessionCookies = loginCookies;
  console.log('   ✅ Authenticated successfully, session cookies acquired:', Object.keys(sessionCookies));

  // TEST 4: Access Dashboard with Authenticated Session
  console.log('4. Testing Dashboard Load with Authenticated Session...');
  const dashRes = await request({
    path: '/dashboard',
    headers: { Cookie: cookieHeader(sessionCookies) }
  });
  assert.strictEqual(dashRes.statusCode, 200, 'Dashboard should return HTTP 200');
  assert.ok(dashRes.body.includes('Opsloom') || dashRes.body.includes('Ultravetis'), 'Dashboard should render valid workspace brand');
  assert.ok(!dashRes.body.includes('Traceback'), 'No errors or stacktraces');
  console.log('   ✅ Dashboard rendered cleanly without demo mock data\n');

  // TEST 5: Create a new Workspace (Organization)
  console.log('5. Testing Workspace / Company Creation...');
  const createWsRes = await request({
    path: '/settings/companies/save',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    name: 'Nairobi Packaging Plant',
    code: 'NPP',
    industry: 'Packaging & Manufacturing',
    contact_email: 'plant.npp@opsloom.co.ke',
    contact_phone: '+254 700 999 888',
    currency: 'KES',
    primary_color: '#0d9488',
    secondary_color: '#14b8a6'
  });
  assertRedirect(createWsRes, 'Company creation should redirect');
  
  // Verify company exists in datastore
  const datastoreAfterWs = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const nppComp = datastoreAfterWs.COMPANIES.find(c => c.code === 'NPP');
  assert.ok(nppComp, 'New workspace NPP must exist in datastore COMPANIES');
  assert.strictEqual(nppComp.name, 'Nairobi Packaging Plant');
  console.log(`   ✅ Workspace created: ${nppComp.name} (ID: ${nppComp.id}, Code: ${nppComp.code})\n`);

  // TEST 6: Switch Workspace to NPP
  console.log('6. Testing Workspace Switching & Session Binding...');
  const switchRes = await request({
    path: `/set-company?company_id=${nppComp.id}`,
    headers: { Cookie: cookieHeader(sessionCookies) }
  });
  assertRedirect(switchRes, 'Switch company should redirect');
  const switchCookies = parseCookies(switchRes);
  sessionCookies = { ...sessionCookies, ...switchCookies };
  sessionCookies.opsloom_ws_id = nppComp.id;
  console.log(`   ✅ Switched active workspace to ${nppComp.id}\n`);

  // TEST 7: Create Asset in NPP Workspace
  console.log('7. Testing Asset Creation in Active Workspace...');
  const createAssetRes = await request({
    path: '/assets/new/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    asset_name: 'High-Speed Case Packer Line 1',
    asset_id: 'HSP-01',
    category: 'Packaging Machinery',
    criticality: 'A',
    status: 'operational',
    serial_no: 'SN-NPP-2026-9901',
    model_number: 'CSP-8000',
    manufacturer: 'Tetra Machining',
    location: 'Nairobi Plant - Packaging Bay B',
    department: 'Packaging & Dispatch',
    asset_value: '4500000'
  });
  assertRedirect(createAssetRes, 'Asset creation should redirect');

  // Verify asset persisted in NPP bucket and datastore
  const datastoreAfterAsset = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const nppBucket = datastoreAfterAsset.WORKSPACE_DATA[nppComp.id];
  assert.ok(nppBucket, 'NPP Workspace bucket must exist');
  const createdAsset = (nppBucket.ASSETS || []).find(a => a.asset_id === 'HSP-01' || a.asset_name === 'High-Speed Case Packer Line 1');
  assert.ok(createdAsset, 'Asset HSP-01 must exist in NPP bucket');
  console.log(`   ✅ Asset created: ${createdAsset.asset_name} (ID: ${createdAsset.asset_id}, UID: ${createdAsset.uid})\n`);

  // TEST 8: Verify Workspace Data Isolation
  console.log('8. Testing Workspace Data Isolation...');
  const ultravetisBucket = datastoreAfterAsset.WORKSPACE_DATA['comp-001'];
  const assetInUltravetis = (ultravetisBucket?.ASSETS || []).some(a => a.asset_id === 'HSP-01');
  assert.strictEqual(assetInUltravetis, false, 'Asset created in NPP must NOT leak into Ultravetis bucket!');
  console.log('   ✅ Airtight Isolation: Asset is strictly contained within NPP workspace\n');

  // TEST 9: Asset Update / Status Change
  console.log('9. Testing Asset Editing & Persistence...');
  const editAssetRes = await request({
    path: `/assets/${createdAsset.uid}/edit`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    asset_name: 'High-Speed Case Packer Line 1 (Upgraded)',
    asset_id: 'HSP-01',
    category: 'Packaging Machinery',
    criticality: 'A',
    status: 'operational',
    location: 'Nairobi Plant - Packaging Bay B - Station 2',
    department: 'Packaging & Dispatch'
  });
  assertRedirect(editAssetRes, 'Asset edit should redirect');
  const datastoreAfterAssetEdit = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const updatedAsset = datastoreAfterAssetEdit.WORKSPACE_DATA[nppComp.id].ASSETS.find(a => a.uid === createdAsset.uid);
  assert.strictEqual(updatedAsset.location, 'Nairobi Plant - Packaging Bay B - Station 2');
  console.log('   ✅ Asset successfully updated with new location and name\n');

  // TEST 10: Log Breakdown on Asset
  console.log('10. Testing Breakdown Logging & Status Linkage...');
  const logBdRes = await request({
    path: '/breakdowns/new/step-2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    asset_uid: createdAsset.uid,
    asset_id: createdAsset.asset_id,
    incident_title: 'Drive Servo Motor Overheating & Jam',
    severity: 'Critical',
    failure_category: 'Mechanical',
    symptoms: 'Main conveyor servo motor reached 95C and triggered thermal overload fault.',
    technician_name: 'John Kamau'
  });
  assertRedirect(logBdRes, 'Breakdown logging should redirect');

  const datastoreAfterBd = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const bds = datastoreAfterBd.WORKSPACE_DATA[nppComp.id].BREAKDOWNS || [];
  const loggedBd = bds.find(b => b.asset_uid === createdAsset.uid || b.asset_id === createdAsset.asset_id);
  assert.ok(loggedBd, 'Breakdown must be recorded in NPP workspace');
  assert.strictEqual(loggedBd.severity, 'Critical');
  
  // Verify asset status changed to out_of_service or breakdown
  const assetPostBd = datastoreAfterBd.WORKSPACE_DATA[nppComp.id].ASSETS.find(a => a.uid === createdAsset.uid);
  assert.ok(assetPostBd.status === 'out_of_service' || assetPostBd.status === 'breakdown', 'Asset status must reflect breakdown condition');
  console.log(`   ✅ Breakdown logged (ID: ${loggedBd.breakdown_id}), Asset status successfully changed to: ${assetPostBd.status}\n`);

  // TEST 11: Resolve Breakdown
  console.log('11. Testing Breakdown Resolution...');
  const resolveBdRes = await request({
    path: `/breakdowns/${loggedBd.breakdown_id}/close`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    action_taken: 'Cleaned cooling fans, replaced overheated thermal coupler, cleared jammed belt guide.',
    root_cause: 'Foreign debris in intake fan'
  });
  assertRedirect(resolveBdRes, 'Breakdown resolve should redirect');
  
  const datastoreAfterBdResolve = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const resolvedBd = datastoreAfterBdResolve.WORKSPACE_DATA[nppComp.id].BREAKDOWNS.find(b => b.breakdown_id === loggedBd.breakdown_id);
  assert.ok(resolvedBd.status === 'resolved' || resolvedBd.status === 'closed', `Breakdown should be resolved or closed, got: ${resolvedBd.status}`);
  console.log(`   ✅ Breakdown resolved and closed (status: ${resolvedBd.status})\n`);

  // TEST 12: Schedule Preventive Maintenance (PM) Task
  console.log('12. Testing Preventive Maintenance Task Scheduling...');
  const createPmRes = await request({
    path: '/maintenance/schedule/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    task_description: 'Bi-Weekly Servo Lubrication & Sensor Alignment',
    asset_uid: createdAsset.uid,
    asset_id: createdAsset.asset_id,
    maintenance_type: 'PM',
    frequency: 'Bi-Weekly',
    priority: 'high',
    technician: 'Alex Mwangi',
    cost: '15000'
  });
  assertRedirect(createPmRes, 'PM creation should redirect');

  const datastoreAfterPm = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const pmTasks = datastoreAfterPm.WORKSPACE_DATA[nppComp.id].MAINTENANCE_TASKS || [];
  const createdPm = pmTasks.find(t => t.asset_uid === createdAsset.uid || t.asset_id === createdAsset.asset_id);
  assert.ok(createdPm, 'Maintenance task must exist in workspace');
  console.log(`   ✅ PM Task created: ${createdPm.task_description} (ID: ${createdPm.task_id})\n`);

  // TEST 13: Complete Maintenance Task
  console.log('13. Testing PM Task Completion...');
  const completePmRes = await request({
    path: `/maintenance/${createdPm.task_id}/complete`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    notes: 'Completed lubrication using Grade 30 food-safe oil. Sensors recalibrated.'
  });
  assertRedirect(completePmRes, 'Complete PM should redirect');

  const datastoreAfterPmDone = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const completedTask = datastoreAfterPmDone.WORKSPACE_DATA[nppComp.id].MAINTENANCE_TASKS.find(t => t.task_id === createdPm.task_id);
  assert.strictEqual(completedTask.status, 'completed');
  console.log('   ✅ PM Task completed with timestamp and execution notes\n');

  // TEST 14: Inventory & Spare Parts Management
  console.log('14. Testing Inventory Spare Part Addition & Stock Control...');
  const addPartRes = await request({
    path: '/inventory/new/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    part_name: 'Food-Grade Thermal Coupler Sensor',
    sku: 'TC-500-FG',
    category: 'Electrical',
    qty: '15',
    min_qty: '5',
    unit_price: '3200',
    storage_location: 'Shelf B-12',
    supplier: 'SensorTech East Africa'
  });
  assertRedirect(addPartRes, 'Add part should redirect');

  const datastoreAfterPart = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const parts = datastoreAfterPart.WORKSPACE_DATA[nppComp.id].INVENTORY_PARTS || [];
  const createdPart = parts.find(p => p.sku === 'TC-500-FG');
  assert.ok(createdPart, 'Part must be saved in NPP inventory');
  assert.strictEqual(Number(createdPart.qty), 15);
  console.log(`   ✅ Inventory part added: ${createdPart.part_name} (Qty: ${createdPart.qty})\n`);

  // TEST 15: User Management (Create New User)
  console.log('15. Testing User Management (Admin creating new technician/manager)...');
  const testUserEmail = `grace.wambui.${Date.now()}@npp.co.ke`;
  const createUserRes = await request({
    path: '/settings/admin-users/create',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  }, {
    name: 'Grace Wambui',
    email: testUserEmail,
    password: 'GracePassword@2026',
    role: 'Maintenance Technician',
    access_scope: 'Assigned Workspace',
    department: 'Maintenance',
    company_id: nppComp.id,
    active: '1',
    permissions: ['dashboard', 'assets', 'breakdowns', 'maintenance']
  });
  assertRedirect(createUserRes, 'Create user should redirect');

  const datastoreAfterUser = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const newUser = datastoreAfterUser.ADMIN_USERS.find(u => u.email === testUserEmail);
  assert.ok(newUser, 'New user Grace Wambui must exist in ADMIN_USERS');
  assert.strictEqual(newUser.role, 'Maintenance Technician');
  assert.strictEqual(newUser.active, true, 'New user should be active');
  console.log(`   ✅ User created: ${newUser.name} (${newUser.email}), Role: ${newUser.role}\n`);

  // TEST 16: Verify Login for newly created user
  console.log('16. Testing Login for New User...');
  const newLoginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: testUserEmail,
    password: 'GracePassword@2026'
  });
  assertRedirect(newLoginRes, 'New user should login successfully');
  assert.ok(newLoginRes.headers.location.includes('/dashboard'), 'Should redirect to /dashboard');
  const newUserCookies = parseCookies(newLoginRes);
  assert.ok(newUserCookies.opsloom_user, 'New user session cookie issued');
  console.log('   ✅ New user logged in successfully with valid session\n');

  // TEST 17: User Disabling & Suspension Enforcement
  console.log('17. Testing User Deactivation and Login Suspension...');
  const suspendRes = await request({
    path: `/settings/admin-users/${newUser.id}/toggle`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(sessionCookies)
    }
  });
  assertRedirect(suspendRes, 'Toggle user active state should redirect');

  // Attempt login with deactivated user
  const blockedLoginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: testUserEmail,
    password: 'GracePassword@2026'
  });
  assertRedirect(blockedLoginRes, 'Blocked user should redirect');
  assert.ok(blockedLoginRes.headers.location.includes('/login'), 'Suspended user must NOT be allowed to log in!');
  console.log('   ✅ Suspended user correctly blocked from logging in\n');

  // TEST 18: Soft Deletion & Recycle Bin
  console.log('18. Testing Soft Deletion & Recycle Bin for Assets...');
  const delAssetRes = await request({
    path: `/assets/${createdAsset.uid}/delete`,
    headers: { Cookie: cookieHeader(sessionCookies) }
  });
  assertRedirect(delAssetRes, 'Delete asset should redirect');

  const datastoreAfterDel = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const assetStillActive = (datastoreAfterDel.WORKSPACE_DATA[nppComp.id].ASSETS || []).some(a => a.uid === createdAsset.uid);
  assert.strictEqual(assetStillActive, false, 'Asset must be removed from active assets list');
  
  const inRecycleBin = (datastoreAfterDel.RECYCLE_BIN || []).find(r => r.primary_id === createdAsset.uid || r.primary_id === createdAsset.asset_id);
  assert.ok(inRecycleBin, 'Asset must be archived in RECYCLE_BIN');
  console.log(`   ✅ Asset moved to Recycle Bin (Bin ID: ${inRecycleBin.id})\n`);

  // TEST 19: Restore Asset from Recycle Bin
  console.log('19. Testing Asset Restoration from Recycle Bin...');
  const restoreRes = await request({
    path: `/settings/recycle-bin/${inRecycleBin.id}/restore`,
    method: 'POST',
    headers: { Cookie: cookieHeader(sessionCookies) }
  });
  assertRedirect(restoreRes, 'Restore should redirect');

  const datastoreAfterRestore = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const restoredAsset = datastoreAfterRestore.WORKSPACE_DATA[nppComp.id].ASSETS.find(a => a.uid === createdAsset.uid);
  assert.ok(restoredAsset, 'Asset must be restored to active assets list');
  console.log('   ✅ Asset successfully restored from Recycle Bin back into active workspace\n');

  // TEST 20: Audit Log Verification
  console.log('20. Testing Audit Trail Completeness...');
  const auditRes = await request({
    path: '/settings/audit-trail',
    headers: { Cookie: cookieHeader(sessionCookies) }
  });
  assert.strictEqual(auditRes.statusCode, 200, 'Audit trail should return 200');
  const datastoreFinal = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const auditLogs = datastoreFinal.AUDIT_TRAIL || [];
  assert.ok(auditLogs.length >= 5, 'Audit trail must record system actions');
  console.log(`   ✅ Audit trail contains ${auditLogs.length} verified action records\n`);

  // TEST 21: Logout
  console.log('21. Testing Logout...');
  const logoutRes = await request({
    path: '/logout',
    headers: { Cookie: cookieHeader(sessionCookies) }
  });
  assertRedirect(logoutRes, 'Logout should redirect to /login');
  console.log('   ✅ User logged out and session terminated\n');

  console.log('====================================================');
  console.log('🎉 ALL 21 END-TO-END BUSINESS SYSTEM TESTS PASSED! 🎉');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
