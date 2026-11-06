'use strict';

const { Pool } = require('pg');
const { hashPassword } = require('../src/security/auth-security');

async function bootstrapStaging() {
  if (process.env.NODE_ENV !== 'staging' || process.env.ALLOW_STAGING_BOOTSTRAP !== 'true') {
    throw new Error('Staging bootstrap is disabled. It requires NODE_ENV=staging and ALLOW_STAGING_BOOTSTRAP=true.');
  }

  const connectionString = process.env.DATABASE_URL;
  const adminEmail = String(process.env.ADMIN_PRIMARY_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.ADMIN_LOGIN_PASSWORD || '');

  if (!connectionString) throw new Error('DATABASE_URL is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('ADMIN_PRIMARY_EMAIL must be a valid email address.');
  if (adminPassword.length < 12) throw new Error('ADMIN_LOGIN_PASSWORD must contain at least 12 characters.');

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const companyById = await client.query('SELECT id, code FROM companies WHERE id = $1 FOR UPDATE;', ['comp-001']);
    const companyByCode = await client.query('SELECT id, code FROM companies WHERE code = $1 FOR UPDATE;', ['UEAL']);

    if (companyByCode.rows[0] && companyByCode.rows[0].id !== 'comp-001') {
      throw new Error('A company already uses code UEAL under a different ID. Resolve the company identity before bootstrap.');
    }

    if (!companyById.rows[0]) {
      await client.query(`
        INSERT INTO companies (
          id, name, code, primary_color, secondary_color,
          logo_light_url, logo_dark_url, show_name_next_to_logo,
          logo_height, logo_width_pct, logo_alignment, logo_fit,
          departments_json, kpi_targets_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()::text)
        ON CONFLICT (id) DO NOTHING;
      `, [
        'comp-001',
        'Ultravetis East Africa Ltd',
        'UEAL',
        '#7E22CE',
        '#F59E0B',
        '/static/brand/ultravetis_logo.png',
        '/static/brand/ultravetis_logo.png',
        false,
        44,
        85,
        'left',
        'contain',
        JSON.stringify(['Engineering', 'Production', 'Logistics & Warehousing', 'Premises']),
        JSON.stringify({})
      ]);
    }

    const existingAdmin = await client.query(
      'SELECT id, email, company_id FROM users WHERE id = $1 OR LOWER(email) = $2 FOR UPDATE;',
      ['USR-001', adminEmail]
    );
    const conflictingAdmin = existingAdmin.rows.find(row => row.id !== 'USR-001' || String(row.email).toLowerCase() !== adminEmail);
    if (conflictingAdmin) {
      throw new Error('The configured administrator email already belongs to a different user record. Resolve it manually before bootstrap.');
    }

    if (!existingAdmin.rows.length) {
      const permissions = [
        'dashboard', 'assets', 'breakdowns', 'maintenance', 'inventory', 'reports',
        'settings_manage', 'users_manage', 'notifications_manage', 'technicians_manage',
        'settings', 'admin', 'companies', 'recycle_bin', 'kpi_targets_manage', 'all'
      ];
      await client.query(`
        INSERT INTO users (
          id, uid, email, name, password, role, access_scope, department, company_id,
          active, permissions_json, edit_permissions_json, delete_permissions_json,
          signature_name, signature_title, signature_font, signature_color, signature_style,
          signature_image_url, profile_image_url, created_at
        )
        VALUES (
          $1, $1, $2, $3, $4, 'Administrator', 'Full System', 'Engineering', 'comp-001',
          true, $5, $5, $6, $3, 'System Administrator', 'Inter', '#7E22CE', 'formal',
          '', '', NOW()::text
        )
        ON CONFLICT (id) DO NOTHING;
      `, [
        'USR-001',
        adminEmail,
        'Laurence Magondu',
        hashPassword(adminPassword),
        JSON.stringify(permissions),
        JSON.stringify(['assets', 'breakdowns', 'maintenance', 'inventory', 'reports', 'companies', 'users_manage', 'technicians_manage', 'recycle_bin', 'kpi_targets_manage', 'all'])
      ]);
    }

    const finalCheck = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM companies WHERE id = 'comp-001' AND code = 'UEAL') AS company_ready,
        EXISTS(SELECT 1 FROM users WHERE id = 'USR-001' AND LOWER(email) = $1 AND company_id = 'comp-001' AND active = true AND COALESCE(password, '') <> '') AS admin_ready;
    `, [adminEmail]);

    if (!finalCheck.rows[0]?.company_ready || !finalCheck.rows[0]?.admin_ready) {
      throw new Error('Staging bootstrap verification failed. No application data was seeded.');
    }

    await client.query('COMMIT');
    console.log('Staging bootstrap complete: comp-001 and the configured administrator are present. No demo assets or business records were inserted.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  bootstrapStaging().catch(error => {
    console.error('Staging bootstrap failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { bootstrapStaging };
