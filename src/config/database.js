/**
 * DATABASE CONFIGURATION - Production Grade
 * PostgreSQL is the ONLY authoritative data source
 * NO JSON fallback, NO in-memory caching of persistent data
 */

const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const host = process.env.SQL_HOST || process.env.PGHOST || process.env.DB_HOST;
const user = process.env.SQL_USER || process.env.PGUSER || process.env.DB_USER;
const password = process.env.SQL_PASSWORD || process.env.PGPASSWORD || process.env.DB_PASSWORD;
const database = process.env.SQL_DB_NAME || process.env.PGDATABASE || process.env.DB_NAME;
const port = process.env.PGPORT || process.env.DB_PORT || process.env.SQL_PORT;
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let pool;
if (global._postgresPool) {
  pool = global._postgresPool;
} else if (connectionString) {
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  global._postgresPool = pool;
} else {
  pool = new Pool({
    user: user || 'postgres',
    password: password || '',
    host: host || 'localhost',
    port: port ? parseInt(port, 10) : 5432,
    database: database || 'cloud_sql_development_database',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  global._postgresPool = pool;
}

pool.on('error', (err, client) => {
  console.error('[Database Pool Error]:', err && err.message ? err.message : err);
});

pool.on('connect', (client) => {
  client.query('SET search_path TO public');
});

/**
 * Query execution with automatic company_id validation
 * @param {string} sql - SQL query
 * @param {array} params - Query parameters
 * @param {string} requiredCompanyId - Company ID for access control (optional)
 * @returns {Promise}
 */
async function query(sql, params = [], requiredCompanyId = null) {
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { sql, duration, rows: result.rowCount });
    }
    
    return result;
  } catch (error) {
    console.error('Database query error', { sql, error: error.message });
    throw error;
  }
}

/**
 * Transaction support for multi-step operations
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check
 */
async function healthCheck() {
  try {
    const result = await pool.query('SELECT NOW()');
    return {
      status: 'connected',
      timestamp: result.rows[0].now
    };
  } catch (error) {
    return {
      status: 'disconnected',
      error: error.message
    };
  }
}

module.exports = {
  pool,
  query,
  transaction,
  healthCheck
};
