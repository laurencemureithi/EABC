'use strict';

const crypto = require('node:crypto');
const PASSWORD_HASH_PREFIX = 'scrypt$';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${derived.toString('hex')}`;
}

function isPasswordHash(value) {
  return typeof value === 'string' && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i.test(value);
}

function verifyPassword(password, storedValue) {
  const stored = String(storedValue || '');
  if (!stored) return false;
  if (isPasswordHash(stored)) {
    const [, saltHex, hashHex] = stored.split('$');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  // Transitional compatibility for existing plaintext credentials. Re-hash
  // immediately after successful authentication; never create new plaintext.
  const actual = Buffer.from(String(password));
  const expected = Buffer.from(stored);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function signSessionUserId(userId, expiresAt, secret) {
  if (!secret || String(secret).length < 32) throw new Error('Session signing secret must contain at least 32 characters.');
  const payload = `${String(userId)}.${Number(expiresAt)}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

function verifySessionUserId(token, secret, now = Date.now()) {
  if (!token || typeof token !== 'string' || !secret || String(secret).length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let payload;
  try { payload = Buffer.from(parts[0], 'base64url').toString('utf8'); } catch (_) { return null; }
  const separator = payload.lastIndexOf('.');
  if (separator < 1) return null;
  const userId = payload.slice(0, separator);
  const expiresAt = Number(payload.slice(separator + 1));
  if (!userId || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch (_) { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  return userId;
}

module.exports = { hashPassword, isPasswordHash, verifyPassword, signSessionUserId, verifySessionUserId };
