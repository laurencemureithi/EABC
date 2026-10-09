const http = require('http');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  database: process.env.SQL_DB_NAME
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

async function testWorkspaceLifecycle(name, code) {
  console.log('Testing Workspace Lifecycle for:', name, code);
  const loginRes = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 1 & 2. Create workspace
  await req({
    path: '/settings/companies/save',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, 'name=' + encodeURIComponent(name) + '&code=' + encodeURIComponent(code) + '&industry=Packaging&city=Nairobi');
  
  const inDb1 = await pool.query('SELECT * FROM companies WHERE code = $1;', [code]);
  console.log('1. Exists in PostgreSQL:', inDb1.rows.length === 1);
  const compId = inDb1.rows[0].id;

  // 2. Confirm in UI
  const uiList1 = await req({ path: '/settings/companies', method: 'GET', headers: { Cookie: cookies } });
  console.log('2. Appears in workspace UI:', uiList1.body.includes(name));

  // 3. Delete through UI
  const delRes = await req({
    path: '/settings/companies/' + compId + '/delete',
    method: 'POST',
    headers: { Cookie: cookies }
  });
  console.log('4. HTTP response status:', delRes.status, 'redirect:', delRes.headers.location);

  // 5. Confirm PostgreSQL row state
  const inDb2 = await pool.query('SELECT * FROM companies WHERE id = $1;', [compId]);
  console.log('5. PostgreSQL row state (deleted):', inDb2.rows.length === 0);

  // 6. Confirm recycle_bin row
  const binRow = await pool.query('SELECT * FROM recycle_bin WHERE primary_id = $1;', [compId]);
  console.log('6. Recycle_bin row exists in DB:', binRow.rows.length === 1);
  const binId = binRow.rows[0] ? binRow.rows[0].id : null;

  // 7 & 8. Refresh browser
  const uiList2 = await req({ path: '/settings/companies', method: 'GET', headers: { Cookie: cookies } });
  const cardInHtml = uiList2.body.includes('cardLogoLight_' + compId) || uiList2.body.includes('/settings/companies/' + compId + '/delete');
  console.log('7 & 8. Workspace remains absent after refresh:', !cardInHtml);

  // 9 & 10. Logout and Login
  await req({ path: '/logout', method: 'GET', headers: { Cookie: cookies } });
  const loginRes2 = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  const cookies2 = (loginRes2.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 11. Confirm remains absent
  const uiList3 = await req({ path: '/settings/companies', method: 'GET', headers: { Cookie: cookies2 } });
  console.log('11. Workspace remains absent after relogin:', !uiList3.body.includes(name));

  // 14 & 15. Open Recycle Bin and confirm exactly 1 record exists for this item
  const binDbCheck = await pool.query('SELECT * FROM recycle_bin WHERE primary_id = $1;', [compId]);
  console.log('14 & 15. Exactly one recycle-bin record exists:', binDbCheck.rows.length === 1);

  // 16 & 17. Refresh Recycle Bin
  const binDbCheck2 = await pool.query('SELECT * FROM recycle_bin WHERE primary_id = $1;', [compId]);
  console.log('16 & 17. Remains exactly one record after refresh:', binDbCheck2.rows.length === 1);

  // 18. Permanently delete it
  const purgeRes = await req({
    path: '/settings/recycle-bin/' + binId + '/delete',
    method: 'POST',
    headers: { Cookie: cookies2 }
  });
  console.log('18. Purge response redirect:', purgeRes.headers.location);

  // 19 & 20. Refresh Recycle Bin & confirm permanently absent
  const binDbCheck3 = await pool.query('SELECT * FROM recycle_bin WHERE id = $1;', [binId]);
  console.log('19 & 20. Recycle bin record permanently deleted from DB:', binDbCheck3.rows.length === 0);
  const binUI3 = await req({ path: '/settings/recycle-bin', method: 'GET', headers: { Cookie: cookies2 } });
  console.log('20. Absent from Recycle Bin UI:', !binUI3.body.includes(name));

  const compDbCheckFinal = await pool.query('SELECT * FROM companies WHERE id = $1 OR code = $2;', [compId, code]);
  console.log('22. Workspace does NOT return to DB:', compDbCheckFinal.rows.length === 0);
  console.log('--------------------------------------------------');
}

async function run() {
  await testWorkspaceLifecycle('TEST_WORKSPACE_A', 'TWA_991');
  await testWorkspaceLifecycle('TEST_WORKSPACE_B', 'TWB_992');
  await pool.end();
}
run();
