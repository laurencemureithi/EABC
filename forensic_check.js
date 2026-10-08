const http = require('http');
const fs = require('fs');

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

async function test() {
  console.log('--- 1. Login as Admin ---');
  const loginRes = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  console.log('Login status:', loginRes.status, 'Cookies:', cookies);

  console.log('--- 2. Create Workspace INVG ---');
  const createRes = await req({
    path: '/settings/companies/save',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, 'name=Investigation+WS&code=INVG');
  console.log('Create status:', createRes.status);

  let d = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const createdComp = d.COMPANIES.find(c => c.code === 'INVG');
  console.log('Created comp in datastore:', createdComp?.id, createdComp?.name);

  console.log('--- 3. Delete Workspace INVG ---');
  const delRes = await req({
    path: `/settings/companies/${createdComp.id}/delete`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  });
  console.log('Delete status:', delRes.status, 'Location:', delRes.headers.location);

  d = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const foundAfterDel = d.COMPANIES.find(c => c.id === createdComp.id);
  console.log('After delete, in datastore COMPANIES:', foundAfterDel ? 'PRESENT' : 'ABSENT');
  const inRecycleBin = (d.RECYCLE_BIN || []).find(b => b.primary_id === createdComp.id);
  console.log('After delete, in RECYCLE_BIN:', inRecycleBin ? 'PRESENT' : 'ABSENT');

  console.log('--- 4. Simulate Browser Refresh: GET /settings/companies ---');
  const refreshRes = await req({
    path: '/settings/companies',
    method: 'GET',
    headers: { 'Cookie': cookies }
  });
  console.log('Refresh status:', refreshRes.status);
  console.log('Does HTML contain "Investigation WS"?', refreshRes.body.includes('Investigation WS'));
  const lines = refreshRes.body.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('Investigation WS')) {
      console.log(`Line ${idx + 1}: ${l.slice(0, 200)}`);
    }
  });

  d = JSON.parse(fs.readFileSync('data/datastore.json', 'utf8'));
  const foundAfterRefresh = d.COMPANIES.find(c => c.id === createdComp.id);
  console.log('After refresh, in datastore COMPANIES:', foundAfterRefresh ? 'PRESENT' : 'ABSENT');
}

test().catch(console.error);
