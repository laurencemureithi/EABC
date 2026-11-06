'use strict';
const assert = require('node:assert/strict');
const {
  hashPassword, isPasswordHash, verifyPassword,
  signSessionUserId, verifySessionUserId
} = require('./src/security/auth-security');
const { tenantCompanyId } = require('./src/security/tenant-scope');

const secret = 'test-only-session-secret-at-least-32-characters-long';
const password = 'Strong-Staging-Password-2026!';
const hash = hashPassword(password);
assert.equal(isPasswordHash(hash), true, 'new passwords must use the scrypt format');
assert.equal(verifyPassword(password, hash), true, 'correct password must verify');
assert.equal(verifyPassword('incorrect-password', hash), false, 'incorrect password must fail');
assert.equal(verifyPassword('Legacy-Password-123', 'Legacy-Password-123'), true, 'legacy plaintext migration path must work');
assert.equal(verifyPassword('wrong', 'Legacy-Password-123'), false, 'legacy plaintext mismatch must fail');

const expires = Date.now() + 60_000;
const token = signSessionUserId('USR-101', expires, secret);
assert.equal(verifySessionUserId(token, secret), 'USR-101', 'valid signed session must resolve user id');
assert.equal(verifySessionUserId(token, 'wrong-secret-that-is-long-enough-to-be-valid'), null, 'wrong signing key must fail');
assert.equal(verifySessionUserId(`${token}x`, secret), null, 'tampered token must fail');
assert.equal(verifySessionUserId(signSessionUserId('USR-101', Date.now() - 1000, secret), secret), null, 'expired token must fail');
assert.equal(verifySessionUserId('USR-101', secret), null, 'unsigned legacy user-id cookie must fail');
assert.throws(() => signSessionUserId('USR-101', expires, 'short'), /32 characters/, 'weak signing key must be rejected');
console.log('PASS: password hashing, legacy migration verification, signed sessions, tamper rejection and expiry checks');

const previousTenant = global._currentCompanyId;
global._currentCompanyId = 'company-a';
assert.equal(tenantCompanyId(undefined, global._currentCompanyId, 'asset'), 'company-a', 'missing tenant ID must inherit authenticated tenant');
assert.equal(tenantCompanyId('company-a', global._currentCompanyId, 'asset'), 'company-a', 'matching tenant ID must pass');
assert.throws(() => tenantCompanyId('company-b', global._currentCompanyId, 'asset'), error => error.code === 'TENANT_SCOPE_VIOLATION', 'cross-tenant writes must be rejected');
global._currentCompanyId = null;
assert.throws(
  () => tenantCompanyId('company-b', global._currentCompanyId, 'asset'),
  error => error.code === 'TENANT_SCOPE_MISSING',
  'missing tenant context must fail closed instead of trusting caller-supplied company IDs'
);
assert.equal(
  tenantCompanyId('company-b', global._currentCompanyId, 'asset', { allowCrossTenant: true }),
  'company-b',
  'only an explicit trusted platform-admin context may target another tenant'
);
assert.throws(
  () => tenantCompanyId(undefined, global._currentCompanyId, 'asset', { allowCrossTenant: true }),
  error => error.code === 'TENANT_SCOPE_MISSING',
  'platform scope must still name the target company for writes'
);
global._currentCompanyId = previousTenant;
console.log('PASS: tenant scoping defaults, matching writes and cross-tenant write rejection');
