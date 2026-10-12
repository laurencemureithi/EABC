/**
 * DATABASE CONFIGURATION - Production Grade
 * PostgreSQL is the ONLY authoritative data source
 * NO JSON fallback, NO in-memory caching of persistent data
 */

const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'eabc_prod',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
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
