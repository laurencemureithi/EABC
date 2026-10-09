const http = require('http');
const dal = require('./src/db/dal');

const req = (opts, postData) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: 3000, ...opts }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  if (postData) r.write(postData);
  r.end();
});

async function runTest() {
  const loginRes = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // 1. Fetch current comp-001 in DB
  const beforeDb = await dal.query('SELECT name, code, designation_line_1, designation_line_2, designation_line_3 FROM companies WHERE id = $1;', ['comp-001']);
  console.log('Before update comp-001:', beforeDb.rows[0]);

  // 2. Save profile update for comp-001
  const updatePayload = 'id=comp-001&name=' + encodeURIComponent('Ultravetis East Africa Ltd') +
    '&code=UEAL&primary_color=' + encodeURIComponent('#1554FF') +
    '&secondary_color=' + encodeURIComponent('#F59E0B') +
    '&designation_line_1=' + encodeURIComponent('Ultravetis HQ Division') +
    '&designation_line_2=' + encodeURIComponent('Plot 45 Enterprise Road, Nairobi') +
    '&designation_line_3=' + encodeURIComponent('Tel: +254 700 123 456 • info@ultravetis.co.ke');

  const saveRes = await req({
    path: '/settings/companies/save',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, updatePayload);
  console.log('Save status:', saveRes.status, 'redirect:', saveRes.headers.location);

  // 3. Check DB immediately after
  const afterDb = await dal.query('SELECT name, code, designation_line_1, designation_line_2, designation_line_3 FROM companies WHERE id = $1;', ['comp-001']);
  console.log('After update comp-001 in DB:', afterDb.rows[0]);

  // 4. Request dashboard
  const dashRes = await req({ path: '/dashboard', method: 'GET', headers: { Cookie: cookies } });
  console.log('Dashboard contains new designation_line_1?:', dashRes.body.includes('Ultravetis HQ Division'));
  console.log('Dashboard contains new designation_line_2?:', dashRes.body.includes('Plot 45 Enterprise Road'));

  // 5. Request settings/companies
  const compPageRes = await req({ path: '/settings/companies', method: 'GET', headers: { Cookie: cookies } });
  console.log('Settings/companies contains new designation_line_1?:', compPageRes.body.includes('Ultravetis HQ Division'));
  console.log('Settings/companies contains new designation_line_2?:', compPageRes.body.includes('Plot 45 Enterprise Road'));

  // 6. Request reports
  const repRes = await req({ path: '/reports', method: 'GET', headers: { Cookie: cookies } });
  console.log('Reports contains new designation_line_1?:', repRes.body.includes('Ultravetis HQ Division'));
  process.exit(0);
}
runTest();
