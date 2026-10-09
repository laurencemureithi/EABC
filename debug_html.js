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

async function debug() {
  const loginRes = await req({
    path: '/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, 'email=opsloom.ke%40gmail.com&password=Admin%40123');
  const cookies = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  // Create workspace
  await req({
    path: '/settings/companies/save',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
  }, 'name=DBG_WS&code=DBG_99&industry=Packaging&city=Nairobi');

  const inDb = await dal.query('SELECT * FROM companies WHERE code = $1;', ['DBG_99']);
  const id = inDb.rows[0].id;
  console.log('Created ID:', id);

  // Delete it
  await req({
    path: '/settings/companies/' + id + '/delete',
    method: 'POST',
    headers: { Cookie: cookies }
  });

  const inDbAfter = await dal.query('SELECT * FROM companies WHERE id = $1;', [id]);
  console.log('In DB after delete:', inDbAfter.rows.length);

  // GET /settings/companies
  const getRes = await req({ path: '/settings/companies', method: 'GET', headers: { Cookie: cookies } });
  console.log('Includes DBG_WS?:', getRes.body.includes('DBG_WS'));
  if (getRes.body.includes('DBG_WS')) {
    const lines = getRes.body.split('\n').filter(l => l.includes('DBG_WS'));
    console.log('Matching lines in HTML:', lines.slice(0, 5));
  }
  process.exit(0);
}
debug();
