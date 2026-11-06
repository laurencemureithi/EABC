'use strict';

const http = require('http');
const https = require('https');
const assert = require('node:assert/strict');
const dal = require('./src/db/dal');

const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_PRIMARY_EMAIL;
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_LOGIN_PASSWORD;
if (!E2E_ADMIN_EMAIL || !E2E_ADMIN_PASSWORD) {
  throw new Error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (or ADMIN_PRIMARY_EMAIL and ADMIN_LOGIN_PASSWORD).');
}
const BASE_URL = process.env.BASE_URL || (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'http://127.0.0.1:3000');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/', BASE_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const headers = { ...(options.headers || {}) };
    const body = postData == null ? null : String(postData);
    if (body != null) headers['Content-Length'] = Buffer.byteLength(body);
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function applyCookies(jar, response) {
  for (const item of response.headers['set-cookie'] || []) {
    const pair = item.split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
}
function cookieHeader(jar) {
  return Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ');
}
function assertRedirect(response, message) {
  assert.ok([302, 303].includes(response.status), `${message}: expected redirect, received ${response.status}`);
}
function form(values) {
  return new URLSearchParams(values).toString();
}

async function runTest() {
  const cookies = {};
  let testCompanyId = null;
  const companiesBefore = await dal.getCompanies(null);
  const originalCompany = companiesBefore.find(c => c.id === 'comp-001') || companiesBefore[0];
  assert.ok(originalCompany, 'A bootstrap company must exist before the branding test.');

  try {
    const login = await request({
      path: '/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, form({ email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD }));
    assertRedirect(login, 'Administrator login');
    applyCookies(cookies, login);
    assert.ok(cookies.opsloom_user, 'Signed administrator session cookie must be issued');

    const suffix = Date.now().toString().slice(-8);
    const code = `TBR${suffix}`;
    const create = await request({
      path: '/settings/companies/save',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(cookies) }
    }, form({
      name: `Temporary Branding Test ${suffix}`,
      code,
      primary_color: '#6D28D9',
      secondary_color: '#F59E0B',
      designation_line_1: 'Temporary Branding Test Header',
      designation_line_2: 'Temporary Staging Test Location',
      designation_line_3: 'Temporary Staging Test Contact'
    }));
    assertRedirect(create, 'Temporary test company creation');

    const createdCompanies = await dal.getCompanies(null);
    const created = createdCompanies.find(c => c.code === code);
    assert.ok(created, 'Temporary test company must be persisted in PostgreSQL');
    testCompanyId = created.id;

    const switchRes = await request({
      path: `/set-company?company_id=${encodeURIComponent(testCompanyId)}`,
      headers: { Cookie: cookieHeader(cookies) }
    });
    assertRedirect(switchRes, 'Switch to temporary test company');
    applyCookies(cookies, switchRes);

    const update = await request({
      path: '/settings/companies/save',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(cookies) }
    }, form({
      id: testCompanyId,
      name: `Temporary Branding Test ${suffix} Updated`,
      code,
      primary_color: '#5B21B6',
      secondary_color: '#FBBF24',
      designation_line_1: 'Updated Temporary Branding Header',
      designation_line_2: 'Updated Temporary Staging Location',
      designation_line_3: 'Updated Temporary Staging Contact'
    }));
    assertRedirect(update, 'Temporary test company branding update');

    const persisted = await dal.getCompanyById(testCompanyId);
    assert.equal(persisted.name, `Temporary Branding Test ${suffix} Updated`);
    assert.equal(persisted.designation_line_1, 'Updated Temporary Branding Header');
    assert.equal(persisted.designation_line_2, 'Updated Temporary Staging Location');
    assert.equal(persisted.designation_line_3, 'Updated Temporary Staging Contact');

    const dashboard = await request({ path: '/dashboard', headers: { Cookie: cookieHeader(cookies) } });
    assert.equal(dashboard.status, 200, 'Dashboard should render for the temporary workspace');
    assert.ok(dashboard.body.includes('Updated Temporary Branding Header'), 'Dashboard should render the persisted branding');

    const settings = await request({ path: '/settings/companies', headers: { Cookie: cookieHeader(cookies) } });
    assert.equal(settings.status, 200, 'Company settings page should render');
    assert.ok(settings.body.includes('Updated Temporary Branding Header'), 'Company settings should render the persisted branding');

    console.log('PASS: temporary company branding persists in PostgreSQL and renders in the UI.');
  } finally {
    if (testCompanyId) {
      // Return to the original workspace before deleting the temporary company.
      try {
        const back = await request({
          path: `/set-company?company_id=${encodeURIComponent(originalCompany.id)}`,
          headers: { Cookie: cookieHeader(cookies) }
        });
        applyCookies(cookies, back);
        await request({
          path: `/settings/companies/${encodeURIComponent(testCompanyId)}/delete`,
          method: 'POST',
          headers: { Cookie: cookieHeader(cookies) }
        });
      } catch (error) {
        console.error('WARNING: Could not automatically clean up temporary branding-test company:', error.message);
      }
    }
  }
}

runTest().catch(error => {
  console.error('FAIL: company branding persistence test:', error);
  process.exitCode = 1;
});
