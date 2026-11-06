'use strict';

try { require('dotenv').config(); } catch (_) {}
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL or POSTGRES_URL is required.');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
  const tables = [
    'users', 'assets', 'breakdowns', 'maintenance_tasks', 'inventory_parts',
    'technicians', 'reports', 'asset_documents', 'asset_spare_parts',
    'recycle_bin', 'notifications', 'messages'
  ];
  const findings = [];
  try {
    const companies = await pool.query('SELECT id FROM companies');
    const knownCompanies = new Set((companies.rows || []).map(row => row.id));
    console.log(`Organizations found: ${knownCompanies.size}`);

    for (const table of tables) {
      const column = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'company_id' LIMIT 1`,
        [table]
      );
      if (!column.rowCount) {
        console.log(`SKIP ${table}: no company_id column`);
        continue;
      }
      const counts = await pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE company_id IS NULL)::int AS null_company, COUNT(*) FILTER (WHERE company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = ${table}.company_id))::int AS orphan_company FROM ${table}`
      );
      const row = counts.rows[0];
      console.log(`${table}: total=${row.total}, null_company_id=${row.null_company}, orphan_company_id=${row.orphan_company}`);
      if (row.null_company || row.orphan_company) findings.push({ table, ...row });
    }

    const duplicateEmails = await pool.query(
      `SELECT LOWER(email) AS email, COUNT(*)::int AS copies FROM users WHERE COALESCE(email, '') <> '' GROUP BY LOWER(email) HAVING COUNT(*) > 1`
    );
    if (duplicateEmails.rowCount) {
      console.log(`Duplicate login email identities: ${duplicateEmails.rowCount}`);
      findings.push({ table: 'users', duplicate_email_groups: duplicateEmails.rows });
    }

    const linkedTables = ['breakdowns', 'maintenance_tasks', 'asset_documents', 'asset_spare_parts'];
    for (const table of linkedTables) {
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table]
      );
      const names = new Set(cols.rows.map(r => r.column_name));
      const linkColumn = names.has('asset_uid') ? 'asset_uid' : (names.has('asset_id') ? 'asset_id' : null);
      if (!linkColumn) continue;
      const linkCheck = await pool.query(
        `SELECT COUNT(*)::int AS broken_links FROM ${table} child LEFT JOIN assets parent ON (parent.uid = child.${linkColumn} OR parent.asset_id = child.${linkColumn}) WHERE child.${linkColumn} IS NOT NULL AND child.${linkColumn} <> '' AND parent.uid IS NULL`
      );
      const broken = linkCheck.rows[0].broken_links;
      console.log(`${table}: unresolved asset links=${broken}`);
      if (broken) findings.push({ table, unresolved_asset_links: broken });
    }

    if (findings.length) {
      console.error('\nTENANT DATA AUDIT FAILED. Resolve these findings before enabling tenant-scoped access:');
      console.error(JSON.stringify(findings, null, 2));
      process.exitCode = 2;
    } else {
      console.log('\nPASS: no null/orphan tenant ownership or duplicate login email groups were detected.');
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Tenant data audit failed:', err.message);
  process.exitCode = 1;
});
