/**
 * MySQL adapter — exposes the same unified DB interface as DocDB adapter
 * but backed by a MySQL database (via mysql2).
 *
 * Table mapping:
 *   collection('app_config')              → table `app_config`
 *   collection('otps')                    → table `otps`
 *   collection('customer_mobile_identity')→ table `customer_mobile_identity`
 *
 * MongoDB → SQL translation:
 *   findOne(query)                        → SELECT … WHERE … LIMIT 1
 *   insertOne(doc)                        → INSERT INTO … SET …
 *   updateOne(filter, update, opts)       → UPDATE … SET … WHERE … / INSERT ON DUPLICATE KEY UPDATE
 *   deleteOne(filter)                     → DELETE … WHERE … LIMIT 1
 *   createIndex(fields, opts)             → CREATE [UNIQUE] INDEX …
 *   getIndexes()                          → SHOW INDEX FROM …
 *
 * Environment variables:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

const mysql = require('mysql2/promise')

// ── Connection ──────────────────────────────────────────────────────────

async function connect (params) {
  const pool = mysql.createPool({
    host: params.MYSQL_HOST || process.env.MYSQL_HOST || 'localhost',
    port: Number(params.MYSQL_PORT || process.env.MYSQL_PORT || 3306),
    user: params.MYSQL_USER || process.env.MYSQL_USER || 'root',
    password: params.MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: params.MYSQL_DATABASE || process.env.MYSQL_DATABASE || 'login_module',
    waitForConnections: true,
    connectionLimit: 5,
    // Ensure Date objects are not converted – we store timestamps as bigint/numbers
    dateStrings: true
  })

  // Verify connectivity
  const conn = await pool.getConnection()
  conn.release()

  const dbClient = {
    _pool: pool,
    collection: (name) => createCollectionHandle(pool, name),
    createCollection: (name) => ensureTable(pool, name),
    listCollections: () => listTables(pool),
    close: () => pool.end()
  }

  return { dbClient }
}

// ── Table definitions ───────────────────────────────────────────────────

/**
 * Known table schemas. Each column list deliberately matches the superset of
 * fields that the application writes.  Unknown collections fall back to a
 * generic JSON-blob table (`_id` + `data` JSON column).
 */
const TABLE_SCHEMAS = {
  app_config: `CREATE TABLE IF NOT EXISTS app_config (
    _id VARCHAR(255) PRIMARY KEY,
    is_enabled TINYINT(1) DEFAULT 0,
    otp_expiration_validity INT DEFAULT 10,
    otp_in_response TINYINT(1) DEFAULT 0,
    auto_register TINYINT(1) DEFAULT 0,
    allow_key_info_update TINYINT(1) DEFAULT 0,
    sms_api_host VARCHAR(500) DEFAULT '',
    sms_endpoint VARCHAR(500) DEFAULT '',
    sms_api_key VARCHAR(500) DEFAULT '',
    sms_template_enabled TINYINT(1) DEFAULT 0,
    sms_template_id VARCHAR(255) DEFAULT '',
    sms_template_string TEXT,
    email_smtp_host VARCHAR(500) DEFAULT '',
    email_smtp_port INT DEFAULT 587,
    email_smtp_user VARCHAR(255) DEFAULT '',
    email_smtp_password VARCHAR(500) DEFAULT '',
    email_from_address VARCHAR(255) DEFAULT '',
    email_from_name VARCHAR(255) DEFAULT '',
    email_template_enabled TINYINT(1) DEFAULT 0,
    email_template_id VARCHAR(255) DEFAULT '',
    email_template_string TEXT,
    updatedAt BIGINT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  otps: `CREATE TABLE IF NOT EXISTS otps (
    otpReferenceId VARCHAR(255) PRIMARY KEY,
    otp VARCHAR(10),
    operation VARCHAR(50),
    loginType VARCHAR(50),
    mobile VARCHAR(50),
    email VARCHAR(255),
    customer_id VARCHAR(255),
    firstname VARCHAR(255),
    lastname VARCHAR(255),
    createdAt BIGINT,
    expiresAt BIGINT,
    otpExpirationValidityMinutes INT,
    consumed TINYINT(1) DEFAULT 0,
    consumedAt BIGINT,
    token TEXT,
    tokenStoredAt BIGINT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  customer_mobile_identity: `CREATE TABLE IF NOT EXISTS customer_mobile_identity (
    _id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255),
    mobile_number VARCHAR(50),
    customer_id INT,
    login_type VARCHAR(20),
    status VARCHAR(20) DEFAULT 'active',
    firstname VARCHAR(255),
    lastname VARCHAR(255),
    resolvedEmail VARCHAR(255),
    created_at DATETIME,
    updated_at DATETIME,
    UNIQUE KEY uniq_email (email),
    UNIQUE KEY uniq_mobile_number (mobile_number),
    UNIQUE KEY uniq_customer_id (customer_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
}

async function ensureTable (pool, name) {
  const ddl = TABLE_SCHEMAS[name]
  if (ddl) {
    await pool.execute(ddl)
  } else {
    // generic JSON-blob fallback
    await pool.execute(`CREATE TABLE IF NOT EXISTS \`${sanitizeName(name)}\` (
      _id VARCHAR(255) PRIMARY KEY,
      data JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  }
}

async function listTables (pool) {
  const [rows] = await pool.execute('SHOW TABLES')
  // SHOW TABLES returns rows like { Tables_in_<dbname>: 'name' }
  return rows.map(r => ({ name: Object.values(r)[0] }))
}

// ── Collection handle ───────────────────────────────────────────────────

function createCollectionHandle (pool, tableName) {
  const table = sanitizeName(tableName)
  return {
    findOne: (query) => sqlFindOne(pool, table, query),
    insertOne: (doc) => sqlInsertOne(pool, table, doc),
    updateOne: (filter, update, options) => sqlUpdateOne(pool, table, filter, update, options),
    deleteOne: (filter) => sqlDeleteOne(pool, table, filter),
    createIndex: (fields, options) => sqlCreateIndex(pool, table, fields, options),
    getIndexes: () => sqlGetIndexes(pool, table)
  }
}

// ── Query translation helpers ───────────────────────────────────────────

function sanitizeName (name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '')
}

/**
 * Convert a MongoDB-style flat query like { email: 'x', status: 'active' }
 * into a WHERE clause with parameterised values.
 */
function buildWhere (query) {
  const keys = Object.keys(query || {})
  if (!keys.length) return { clause: '1=1', values: [] }

  const conditions = []
  const values = []
  for (const key of keys) {
    const col = sanitizeName(key)
    const val = query[key]
    if (val === null || val === undefined) {
      conditions.push(`\`${col}\` IS NULL`)
    } else {
      conditions.push(`\`${col}\` = ?`)
      values.push(val)
    }
  }
  return { clause: conditions.join(' AND '), values }
}

/**
 * Convert a row from MySQL (with TINYINT booleans) back to the shape callers expect.
 * Boolean columns are stored as TINYINT(1); convert them back to true/false.
 */
const BOOLEAN_COLUMNS = new Set([
  'is_enabled', 'otp_in_response', 'auto_register', 'allow_key_info_update', 'consumed',
  'sms_template_enabled', 'email_template_enabled'
])

function hydrateRow (row) {
  if (!row) return null
  const out = { ...row }
  for (const col of BOOLEAN_COLUMNS) {
    if (col in out) {
      out[col] = !!out[col]
    }
  }
  return out
}

/** Prepare a value for MySQL insertion – booleans → 0/1, Dates → ISO string, undefined → null. */
function toSqlValue (v) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
  return v
}

// ── Column introspection cache ──────────────────────────────────────────

const _columnCache = {}

/**
 * Get valid column names for a table (cached per table per pool).
 */
async function getTableColumns (pool, table) {
  if (_columnCache[table]) return _columnCache[table]
  try {
    const [rows] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``)
    const cols = new Set(rows.map(r => r.Field))
    _columnCache[table] = cols
    return cols
  } catch {
    return null // table doesn't exist yet
  }
}

/**
 * Filter an object to only include keys that are valid columns in the table.
 * This prevents ER_BAD_FIELD_ERROR when DocDB-style code sets fields
 * that don't exist as MySQL columns (e.g. legacy field cleanup).
 */
async function filterValidColumns (pool, table, obj) {
  if (!obj || typeof obj !== 'object') return obj
  const validCols = await getTableColumns(pool, table)
  if (!validCols) return obj // table unknown, pass through
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (validCols.has(k)) out[k] = v
  }
  return out
}

// ── CRUD ────────────────────────────────────────────────────────────────

async function sqlFindOne (pool, table, query) {
  const { clause, values } = buildWhere(query)
  let rows
  try {
    const [result] = await pool.execute(
      `SELECT * FROM \`${table}\` WHERE ${clause} LIMIT 1`,
      values
    )
    rows = result
  } catch (err) {
    // Unknown column in WHERE clause — treat as "not found" (matches DocDB behavior
    // where querying a non-existent field simply returns no documents).
    if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) {
      const notFound = new Error('Document not found')
      notFound.code = 'DOCUMENT_NOT_FOUND'
      throw notFound
    }
    throw err
  }
  if (!rows.length) {
    // DocDB throws "Document not found" — replicate the same behaviour so that
    // upper layers (findOneOrNull, getAppConfig) handle it identically.
    const err = new Error('Document not found')
    err.code = 'DOCUMENT_NOT_FOUND'
    throw err
  }
  return hydrateRow(rows[0])
}

async function sqlInsertOne (pool, table, doc) {
  const safeDoc = await filterValidColumns(pool, table, doc)
  const keys = Object.keys(safeDoc)
  if (!keys.length) return

  const cols = keys.map(k => `\`${sanitizeName(k)}\``).join(', ')
  const placeholders = keys.map(() => '?').join(', ')
  const values = keys.map(k => toSqlValue(safeDoc[k]))

  await pool.execute(
    `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
    values
  )
}

async function sqlUpdateOne (pool, table, filter, update, options = {}) {
  const setFields = update?.$set || {}
  const setOnInsert = update?.$setOnInsert || {}
  const upsert = !!options.upsert

  // Filter out fields set to null that may not exist as columns (e.g. legacy field cleanup)
  const safeSetFields = await filterValidColumns(pool, table, setFields)
  const safeSetOnInsert = await filterValidColumns(pool, table, setOnInsert)
  const safeFilter = await filterValidColumns(pool, table, filter)

  if (upsert) {
    // Merge filter + $set + $setOnInsert into a single INSERT … ON DUPLICATE KEY UPDATE
    const insertDoc = { ...safeFilter, ...safeSetOnInsert, ...safeSetFields }
    const keys = Object.keys(insertDoc)
    if (!keys.length) return

    const cols = keys.map(k => `\`${sanitizeName(k)}\``).join(', ')
    const placeholders = keys.map(() => '?').join(', ')
    const insertValues = keys.map(k => toSqlValue(insertDoc[k]))

    // ON DUPLICATE KEY UPDATE only applies $set fields
    const updateKeys = Object.keys(safeSetFields)
    if (updateKeys.length) {
      const updatePart = updateKeys.map(k => `\`${sanitizeName(k)}\` = VALUES(\`${sanitizeName(k)}\`)`).join(', ')
      await pool.execute(
        `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updatePart}`,
        insertValues
      )
    } else {
      await pool.execute(
        `INSERT IGNORE INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
        insertValues
      )
    }
    return
  }

  // Standard UPDATE … SET … WHERE …
  const updateKeys = Object.keys(safeSetFields)
  if (!updateKeys.length) return

  const setPart = updateKeys.map(k => `\`${sanitizeName(k)}\` = ?`).join(', ')
  const setValues = updateKeys.map(k => toSqlValue(safeSetFields[k]))

  const { clause, values: whereValues } = buildWhere(safeFilter)
  await pool.execute(
    `UPDATE \`${table}\` SET ${setPart} WHERE ${clause} LIMIT 1`,
    [...setValues, ...whereValues]
  )
}

async function sqlDeleteOne (pool, table, filter) {
  const { clause, values } = buildWhere(filter)
  await pool.execute(
    `DELETE FROM \`${table}\` WHERE ${clause} LIMIT 1`,
    values
  )
}

async function sqlCreateIndex (pool, table, fields, options = {}) {
  const fieldKeys = Object.keys(fields)
  const indexName = options.name || `idx_${fieldKeys.join('_')}`
  const unique = options.unique ? 'UNIQUE' : ''
  const colList = fieldKeys.map(k => `\`${sanitizeName(k)}\``).join(', ')

  try {
    await pool.execute(
      `CREATE ${unique} INDEX \`${sanitizeName(indexName)}\` ON \`${table}\` (${colList})`
    )
  } catch (err) {
    // Ignore "Duplicate key name" — index already exists
    if (err.code !== 'ER_DUP_KEYNAME') throw err
  }
  return indexName
}

async function sqlGetIndexes (pool, table) {
  const [rows] = await pool.execute(`SHOW INDEX FROM \`${table}\``)
  // Deduplicate by Key_name
  const seen = new Set()
  return rows.filter(r => {
    if (seen.has(r.Key_name)) return false
    seen.add(r.Key_name)
    return true
  }).map(r => ({ name: r.Key_name, unique: !r.Non_unique }))
}

module.exports = { connect }
