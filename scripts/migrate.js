/**
 * EABC / Opsloom Database Migration Runner
 * Applies version-controlled SQL migrations safely and trackably in PostgreSQL.
 * Usage: node scripts/migrate.js
 */

try {
  require('dotenv').config();
} catch (e) {}

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function getMigrationPool() {
  const host = process.env.SQL_HOST || process.env.PGHOST;
  const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || process.env.PGUSER;
  const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.SQL_DB_NAME || process.env.PGDATABASE;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (process.env.SQL_ADMIN_USER && host && database) {
    const cfg = {
      host,
      user,
      password: password || '',
      database,
      max: 2,
      connectionTimeoutMillis: 10000
    };
    if (process.env.PGPORT && !String(host).startsWith('/')) {
      cfg.port = parseInt(process.env.PGPORT, 10);
    }
    return new Pool(cfg);
  }

  if (connectionString) {
    return new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000 });
  }

  if (host && user && database) {
    const cfg = {
      host,
      user,
      password: password || '',
      database,
      max: 2,
      connectionTimeoutMillis: 10000
    };
    if (process.env.PGPORT && !String(host).startsWith('/')) {
      cfg.port = parseInt(process.env.PGPORT, 10);
    }
    return new Pool(cfg);
  }

  throw new Error('Database connection details not configured in environment.');
}

async function runMigrations() {
  console.log('\n====================================================');
  console.log('🔄 EABC POSTGRESQL DATABASE MIGRATION RUNNER');
  console.log('====================================================\n');

  let pool;
  try {
    pool = getMigrationPool();

    // Ensure schema_migrations tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Fetch applied migrations
    const res = await pool.query('SELECT migration_name FROM schema_migrations ORDER BY id ASC;');
    const appliedSet = new Set((res.rows || []).map(r => r.migration_name));

    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('ℹ️ No migrations directory found at:', migrationsDir);
      process.exit(0);
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration file(s). ${appliedSet.size} already applied.\n`);

    let appliedCount = 0;
    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        console.log(`  ⏩ [Skipped]  ${file} (already applied)`);
        continue;
      }

      console.log(`  🚀 [Applying] ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query(sqlContent);
        await client.query(
          'INSERT INTO schema_migrations (migration_name, applied_at) VALUES ($1, NOW());',
          [file]
        );
        await client.query('COMMIT;');
      } catch (migrationErr) {
        await client.query('ROLLBACK;');
        throw migrationErr;
      } finally {
        client.release();
      }

      console.log(`  ✅ [Applied]  ${file} successfully.`);
      appliedCount++;
    }

    console.log('\n====================================================');
    console.log(`🎉 MIGRATIONS COMPLETE: ${appliedCount} migration(s) newly applied.`);
    console.log('====================================================\n');
    if (pool) await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ MIGRATION FAILED:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    if (err.hint) console.error('   Hint:', err.hint);
    if (pool) try { await pool.end(); } catch (e) {}
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
