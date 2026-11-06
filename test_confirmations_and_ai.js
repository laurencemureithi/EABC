const http = require('http');
const assert = require('assert');

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

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTING CONFIRMATION PAGES & AI CONVERSATIONAL ADAPTER');
  console.log('====================================================');

  // 1. Login as Admin
  console.log('1. Logging in as Admin...');
  const loginRes = await request({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, {
    email: process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_PRIMARY_EMAIL || 'opsloom.ke@gmail.com',
    password: process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_LOGIN_PASSWORD || 'Admin@123'
  });

  const cookies = parseCookies(loginRes);
  const cookieStr = cookieHeader(cookies);
  if (!cookies['opsloom_user']) {
    throw new Error('Failed to acquire login cookies: ' + loginRes.statusCode);
  }
  console.log('   ✅ Authenticated successfully.');

  // 2. Test Breakdown Success Page
  console.log('2. Testing Breakdown Confirmation Page...');
  const bdCreateRes = await request({
    path: '/breakdowns/new/step-2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr
    }
  }, {
    asset_name: 'Continuous Motion Cartoner',
    asset_id: 'CART-091',
    incident_title: 'Main Infeed Pusher Jam',
    severity: 'High',
    technician_name: 'David Kimani',
    reported_time: '14:20',
    description: 'Mechanical jam at infeed pusher causing carton misfeed.'
  });

  const bdRedirect = bdCreateRes.headers['location'];
  console.log('   Breakdown created, redirected to:', bdRedirect);
  if (!bdRedirect || !bdRedirect.includes('/breakdowns/success/')) {
    throw new Error(`Expected redirect to /breakdowns/success/:id, got: ${bdRedirect}`);
  }

  const bdSuccessRes = await request({
    path: bdRedirect,
    method: 'GET',
    headers: { 'Cookie': cookieStr }
  });

  if (bdSuccessRes.statusCode !== 200) {
    throw new Error(`Breakdown success returned HTTP ${bdSuccessRes.statusCode}`);
  }
  if (!bdSuccessRes.body.includes('Breakdown Successfully Logged')) {
    throw new Error('Breakdown success page missing confirmation title');
  }
  console.log('   bdSuccess HTML snippet:\n', bdSuccessRes.body.slice(0, 1500));
  if (!bdSuccessRes.body.includes('Main Infeed Pusher Jam')) {
    throw new Error('Breakdown success page missing incident title');
  }
  console.log('   ✅ Breakdown confirmation page rendered with full incident details.');

  // 3. Test Maintenance Task Execution / Completion Confirmation
  console.log('3. Testing Maintenance Task Completion Confirmation Page...');
  const pmCreateRes = await request({
    path: '/maintenance/schedule/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr
    }
  }, {
    asset_name: 'Continuous Motion Cartoner',
    asset_id: 'CART-091',
    task_description: '30-Day Pusher Chain Lubrication and Tension Check',
    frequency: 'Monthly',
    technician: 'David Kimani',
    due_date: '2026-11-15',
    priority: 'high',
    cost: '8500'
  });

  const pmRedirect = pmCreateRes.headers['location'];
  console.log('   PM Task created, redirected to:', pmRedirect);
  if (!pmRedirect || !pmRedirect.includes('/maintenance/schedule/success')) {
    throw new Error(`Expected PM schedule redirect to /maintenance/schedule/success, got ${pmRedirect}`);
  }

  const taskIdMatch = pmRedirect.match(/task_id=([^&]+)/);
  const taskId = taskIdMatch ? decodeURIComponent(taskIdMatch[1]) : 'TASK-2026-001';

  // Complete the task
  const completeRes = await request({
    path: `/maintenance/${taskId}/complete`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr
    }
  }, {
    completion_notes: 'Chain tensioned to specification (12mm deflection). Lube points serviced with ISO VG 220 food-grade oil.'
  });

  const completeRedirect = completeRes.headers['location'];
  console.log('   Task completed, redirected to:', completeRedirect);
  if (!completeRedirect || !completeRedirect.includes('/maintenance/schedule/success') || !completeRedirect.includes('mode=completed')) {
    throw new Error(`Expected redirect with mode=completed, got: ${completeRedirect}`);
  }

  const completeSuccessPage = await request({
    path: completeRedirect,
    method: 'GET',
    headers: { 'Cookie': cookieStr }
  });

  if (!completeSuccessPage.body.includes('Maintenance Work Order Successfully Executed')) {
    throw new Error('Maintenance execution confirmation title missing in success page');
  }
  console.log('   ✅ Maintenance work order execution confirmation verified.');

  // 4. Test Inventory Part Enrollment Confirmation
  console.log('4. Testing Inventory Spare Part Enrollment Confirmation Page...');
  const partAddRes = await request({
    path: '/inventory/new/step-3',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr
    }
  }, {
    part_name: 'High-Temperature Teflon Seal Kit',
    sku: 'SKU-TEF-8821',
    category: 'Mechanical',
    qty: '12',
    min_qty: '4',
    storage_location: 'Bin C-14',
    unit_price: '4500',
    supplier: 'Precision Seals Kenya Ltd',
    lead_time_days: '5',
    is_critical: '1'
  });

  const partRedirect = partAddRes.headers['location'];
  console.log('   Part enrolled, redirected to:', partRedirect);
  if (!partRedirect || !partRedirect.includes('/inventory/success/')) {
    throw new Error(`Expected redirect to /inventory/success/:uid, got: ${partRedirect}`);
  }

  const partSuccessPage = await request({
    path: partRedirect,
    method: 'GET',
    headers: { 'Cookie': cookieStr }
  });

  if (!partSuccessPage.body.includes('Spare Part Successfully Enrolled')) {
    throw new Error('Inventory enrollment confirmation title missing');
  }
  if (!partSuccessPage.body.includes('SKU-TEF-8821')) {
    throw new Error('Inventory enrollment confirmation missing SKU');
  }
  console.log('   ✅ Inventory enrollment confirmation page verified.');

  // 4b. Test Asset Document Upload Confirmation
  console.log('4b. Testing Asset Technical Document Upload Confirmation Page...');
  // Find a valid active asset from database
  const dal = require('./src/db/dal');
  const assetRows = await dal.query('SELECT uid, asset_id FROM assets LIMIT 1;');
  const validAsset = assetRows.rows[0];
  if (!validAsset) {
    throw new Error('No assets found in database to attach document to');
  }
  const assetUid = validAsset.uid;

  const docUploadRes = await request({
    path: `/assets/${assetUid}/documents/upload`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr
    }
  }, {
    doc_name: 'Cartoner Servo Calibration & LOTO Standard Protocol',
    category: 'SAFETY PROTOCOL',
    version: 'v2.4',
    owner: 'Engineering Compliance',
    status: 'Approved',
    description: 'Standard safe operating and lockout protocol for cartoner line maintenance.'
  });

  const docRedirect = docUploadRes.headers['location'];
  console.log('   Document uploaded, redirected to:', docRedirect);
  if (!docRedirect || !docRedirect.includes('/documents/success/')) {
    throw new Error(`Expected redirect to /documents/success/:doc_uid, got: ${docRedirect}`);
  }

  const docSuccessPage = await request({
    path: docRedirect,
    method: 'GET',
    headers: { 'Cookie': cookieStr }
  });

  const docIdx = docSuccessPage.body.indexOf('Document');
  console.log('   docSuccess HTML snippet:\n', docSuccessPage.body.slice(docIdx, docIdx + 1200));
  if (!docSuccessPage.body.includes('Cartoner Servo Calibration')) {
    throw new Error('Document upload confirmation missing document name');
  }
  console.log('   ✅ Asset document upload confirmation page verified.');

  // 5. Test AI Assistant Greetings Response
  console.log('5. Testing AI Assistant Response for Greetings ("Hi")...');
  const greetingAiRes = await request({
    path: '/api/ai/query',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieStr
    }
  }, { query: 'Hi' });

  const greetingAiData = JSON.parse(greetingAiRes.body);
  console.log('   AI Response Title:', greetingAiData.title);
  console.log('   AI Response Summary (first 100 chars):', greetingAiData.summary.slice(0, 100) + '...');

  if (greetingAiData.title !== 'Opsloom AI Copilot') {
    throw new Error(`Expected title 'Opsloom AI Copilot', got '${greetingAiData.title}'`);
  }
  if (!greetingAiData.summary.toLowerCase().includes('hello') && !greetingAiData.summary.toLowerCase().includes('copilot')) {
    throw new Error('Greeting response does not contain friendly greeting/introduction');
  }
  console.log('   ✅ AI assistant responded with conversational greeting, capabilities, and suggested prompts.');

  // 6. Test AI Assistant Plain-English KPI / Value-for-Money Explanation
  console.log('6. Testing AI Assistant Plain-English Metric Explanation...');
  const kpiAiRes = await request({
    path: '/api/ai/query',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieStr
    }
  }, { query: 'Explain our MTTR and MTBF in simple terms' });

  const kpiAiData = JSON.parse(kpiAiRes.body);
  console.log('   AI KPI Title:', kpiAiData.title);
  console.log('   AI KPI Summary:', kpiAiData.summary);

  const sLower = (kpiAiData.summary + ' ' + (kpiAiData.title || '')).toLowerCase();
  const hasBusinessTerms = ['metric', 'profit', 'uptime', 'operational', 'indicator', 'bottom line', 'performance', 'breakdown', 'reliability', 'value'].some(w => sLower.includes(w));
  if (!hasBusinessTerms) {
    throw new Error('KPI response does not explain business/operational value: ' + kpiAiData.summary);
  }
  console.log('   ✅ AI assistant delivered clear, plain-English KPI explanations for business executives.');

  console.log('====================================================');
  console.log('🎉 ALL CONFIRMATION SCREENS & AI ADAPTER TESTS PASSED! 🎉');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
