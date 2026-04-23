# MySQL Backend Guide

MySQL backend for the login-module. Activated by setting `DB_TYPE=mysql` in `.env`. The adapter is at `actions/lib/db-adapters/mysql-adapter.js`.

---

## Overview

The MySQL adapter translates the application's MongoDB-style API (findOne, insertOne, updateOne, deleteOne) into SQL queries. It uses connection pooling via `mysql2/promise` and provides the same interface as the DocDB adapter — all application code works identically with either backend.

### Key Characteristics

- **Relational** — fixed table schemas with typed columns
- **Self-hosted** — you manage the MySQL instance (cloud or on-premise)
- **No IMS token required** — connects directly with MySQL credentials
- **Column-aware** — `filterValidColumns` strips unknown fields before insert/update to prevent SQL errors
- **Boolean hydration** — TINYINT(1) columns are converted back to `true`/`false` on read

---

## Prerequisites

1. **MySQL 5.7+** or **MySQL 8.x** instance accessible from the runtime environment
2. **`mysql2`** npm package (already in `package.json`)
3. **Database user** with CREATE TABLE, CREATE INDEX, INSERT, UPDATE, DELETE, SELECT privileges

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_TYPE` | Yes | `docdb` | Set to `mysql` to activate MySQL backend |
| `MYSQL_HOST` | Yes | `localhost` | MySQL server hostname or IP |
| `MYSQL_PORT` | No | `3306` | MySQL server port |
| `MYSQL_USER` | Yes | `root` | MySQL username |
| `MYSQL_PASSWORD` | Yes | — | MySQL password |
| `MYSQL_DATABASE` | Yes | `login_module` | Database name (must exist) |

Add these to your `.env`:

```bash
DB_TYPE=mysql
MYSQL_HOST=172.171.225.184
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=rootpassword
MYSQL_DATABASE=mydb
```

---

## Setup

### 1. Create the database (if it doesn't exist)

```sql
CREATE DATABASE IF NOT EXISTS mydb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Install dependencies

```bash
npm install
```

`mysql2` is already in `package.json`.

### 3. Configure `.env`

```bash
echo 'DB_TYPE=mysql' >> .env
echo 'MYSQL_HOST=your-host' >> .env
echo 'MYSQL_PORT=3306' >> .env
echo 'MYSQL_USER=root' >> .env
echo 'MYSQL_PASSWORD=your-password' >> .env
echo 'MYSQL_DATABASE=your-database' >> .env
```

### 4. Run database setup

```bash
npm run setup-db
```

Expected output:

```
=== Database Setup (MYSQL) ===
Host    : 172.171.225.184
Database: mydb

[1/5] Connecting to database... ✓ Connected
[2/5] Creating collections/tables...
   ✓ Created: app_config
   ✓ Created: otps
   ✓ Created: customer_mobile_identity
[3/5] Creating indexes on customer_mobile_identity...
   ✓ Index created: uniq_mobile_number (unique on mobile_number)
   ✓ Index created: uniq_email (unique on email)
   ✓ Index created: uniq_customer_id (unique on customer_id)
[4/5] Seeding default app_config document... ✓
[5/5] Verifying setup... ✓

=== Setup Complete ===
```

---

## Table Schemas

The setup script creates three tables automatically.

### `app_config`

```sql
CREATE TABLE IF NOT EXISTS app_config (
  _id VARCHAR(255) PRIMARY KEY,
  is_enabled TINYINT(1) DEFAULT 0,
  otp_expiration_validity INT DEFAULT 10,
  otp_in_response TINYINT(1) DEFAULT 0,
  auto_register TINYINT(1) DEFAULT 0,
  allow_key_info_update TINYINT(1) DEFAULT 0,
  sms_api_host VARCHAR(500) DEFAULT '',
  sms_endpoint VARCHAR(500) DEFAULT '',
  sms_api_key VARCHAR(500) DEFAULT '',
  sms_sender_id VARCHAR(100) DEFAULT '',
  sms_type VARCHAR(50) DEFAULT 'OTP',
  sms_fallback_enabled TINYINT(1) DEFAULT 0,
  sms_ics_api_host VARCHAR(500) DEFAULT 'https://sms.sendmsg.in',
  sms_ics_endpoint VARCHAR(500) DEFAULT '/smpp',
  sms_ics_username VARCHAR(255) DEFAULT '',
  sms_ics_password VARCHAR(500) DEFAULT '',
  sms_ics_sender VARCHAR(100) DEFAULT '',
  sms_ics_urlshortening VARCHAR(10) DEFAULT '1',
  sms_template_enabled TINYINT(1) DEFAULT 0,
  sms_template_id VARCHAR(255) DEFAULT '',
  sms_template_string TEXT,
  email_smtp_host VARCHAR(500) DEFAULT '',
  email_smtp_port INT DEFAULT 587,
  email_smtp_user VARCHAR(255) DEFAULT '',
  email_smtp_password VARCHAR(500) DEFAULT '',
  email_from_address VARCHAR(255) DEFAULT '',
  email_from_name VARCHAR(255) DEFAULT '',
  email_subject VARCHAR(255) DEFAULT 'Your OTP for Vijay Sales',
  email_template_enabled TINYINT(1) DEFAULT 0,
  email_template_id VARCHAR(255) DEFAULT '',
  email_template_string TEXT,
  google_sso_enabled TINYINT(1) DEFAULT 1,
  google_client_id VARCHAR(500) DEFAULT '',
  google_client_secret VARCHAR(500) DEFAULT '',
  updatedAt BIGINT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### `otps`

```sql
CREATE TABLE IF NOT EXISTS otps (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### `customer_mobile_identity`

```sql
CREATE TABLE IF NOT EXISTS customer_mobile_identity (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## How It Works

### Connection Flow

1. `db.js` calls `getAdapter(params)` → returns mysql-adapter
2. `mysql-adapter.connect(params)` creates a `mysql2` connection pool (limit: 5)
3. Verifies connectivity with a test `getConnection()` / `release()`
4. Returns `{ dbClient }` with the unified interface

### MongoDB → SQL Translation

| MongoDB-style call | SQL equivalent |
|---|---|
| `findOne({ email: 'a@b.com' })` | `SELECT * FROM table WHERE email = ? LIMIT 1` |
| `insertOne({ email: 'a@b.com', ... })` | `INSERT INTO table (email, ...) VALUES (?, ...)` |
| `updateOne(filter, { $set: {...} })` | `UPDATE table SET ... WHERE ... LIMIT 1` |
| `updateOne(filter, { $set, $setOnInsert }, { upsert: true })` | `INSERT INTO table (...) VALUES (...) ON DUPLICATE KEY UPDATE ...` |
| `deleteOne({ email: 'a@b.com' })` | `DELETE FROM table WHERE email = ? LIMIT 1` |
| `createIndex({ email: 1 }, { unique: true })` | `CREATE UNIQUE INDEX idx ON table (email)` |
| `getIndexes()` | `SHOW INDEX FROM table` |

### Column Safety

The adapter uses **column introspection** to prevent `ER_BAD_FIELD_ERROR`:

- `filterValidColumns(pool, table, obj)` — queries `SHOW COLUMNS` (cached per table) and strips unknown keys from objects before insert/update
- `findOne()` catches `ER_BAD_FIELD_ERROR` in WHERE and throws `"Document not found"` (matches DocDB behavior)
- DocDB-style fields like `firstName` (camelCase) are silently stripped since the MySQL column is `firstname` (lowercase)

### Boolean Handling

MySQL stores booleans as `TINYINT(1)`. The adapter:

- **On write:** converts `true`/`false` to `1`/`0` via `toSqlValue()`
- **On read:** converts `0`/`1` back to `false`/`true` via `hydrateRow()` for known boolean columns: `is_enabled`, `otp_in_response`, `auto_register`, `allow_key_info_update`, `consumed`
- **On read:** converts `0`/`1` back to `false`/`true` via `hydrateRow()` for known boolean columns such as `is_enabled`, `otp_in_response`, `auto_register`, `allow_key_info_update`, `sms_template_enabled`, `email_template_enabled`, `sms_fallback_enabled`, `google_sso_enabled`, `consumed`

---

## Error Behavior

| Scenario | MySQL Error | Mapped Behavior |
|---|---|---|
| Row not found | No rows returned | Throws `"Document not found"` (code: `DOCUMENT_NOT_FOUND`) |
| Duplicate unique key | `ER_DUP_ENTRY` (errno 1062) | Propagated; detected by `isUniqueConstraintError()` |
| Table not found | `ER_NO_SUCH_TABLE` (errno 1146) | Detected by `isCollectionNotFoundError()` |
| Unknown column in WHERE | `ER_BAD_FIELD_ERROR` (errno 1054) | Throws `"Document not found"` |
| Unknown column in INSERT/UPDATE | — | Silently stripped by `filterValidColumns()` |

---

## Adapter Interface

```javascript
const adapter = require('./actions/lib/db-adapters/mysql-adapter')
const { dbClient } = await adapter.connect({
  MYSQL_HOST: '172.171.225.184',
  MYSQL_PORT: 3307,
  MYSQL_USER: 'root',
  MYSQL_PASSWORD: 'rootpassword',
  MYSQL_DATABASE: 'mydb'
})

// Same interface as DocDB
const col = dbClient.collection('otps')
await col.findOne({ otpReferenceId: 'otp_123' })
await col.insertOne({ otpReferenceId: 'otp_123', otp: '1234', consumed: false, ... })
await col.updateOne({ otpReferenceId: 'otp_123' }, { $set: { consumed: true } })
await col.deleteOne({ otpReferenceId: 'otp_123' })

await dbClient.close()  // closes the connection pool
```

---

## Deployment Configuration

All actions receive MySQL credentials via `ext.config.yaml` inputs:

```yaml
inputs:
  DB_TYPE: $DB_TYPE
  MYSQL_HOST: $MYSQL_HOST
  MYSQL_PORT: $MYSQL_PORT
  MYSQL_USER: $MYSQL_USER
  MYSQL_PASSWORD: $MYSQL_PASSWORD
  MYSQL_DATABASE: $MYSQL_DATABASE
```

These are injected from `.env` at deploy time. The `otp` action in `app.config.yaml` also receives these inputs.

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `ECONNREFUSED` | MySQL not running or wrong host/port | Verify `MYSQL_HOST` and `MYSQL_PORT`; check MySQL is running |
| `Access denied for user` | Wrong credentials | Verify `MYSQL_USER` and `MYSQL_PASSWORD` |
| `Unknown database` | Database doesn't exist | Create it: `CREATE DATABASE mydb` |
| `ER_DUP_ENTRY` during setup | Tables already seeded | Safe to ignore — setup script checks before inserting |
| `ER_BAD_FIELD_ERROR` | Code sends a field not in the table schema | Handled automatically by `filterValidColumns`; if persistent, check the table DDL |
| `Duplicate column name` | Table DDL has case-collision | Column names are case-insensitive in MySQL; use only lowercase in DDL |
| Connection timeout in I/O Runtime | MySQL not reachable from Adobe network | Ensure MySQL is publicly accessible or use a VPN/tunnel |

---

## Testing with MySQL

```bash
# Run the dual-backend test suite (MySQL only)
node scripts/test-mysql.js mysql

# Run the full dual-backend test suite
node scripts/test-mysql.js
```

The test suite runs 81 assertions across 5 test suites:

| Suite | Tests | Coverage |
|---|---|---|
| Adapter Layer | 23 | connect, list, findOne, insertOne, updateOne, deleteOne, upsert, unique constraints, filterValidColumns, getIndexes |
| db.js Facade | 13 | getCollection, getAppConfig, findOneOrNull, error classifiers, normalizeAppConfig |
| Config Action | 20 | GET, POST, PUT, PATCH, DELETE, validation, auto-create, backward compat |
| OTP Service | 16 | generate (email/mobile), verify (correct/wrong/consumed/bad ref), persistence |
| Customer Identity | 9 | insert, find by email/mobile/customer_id, update, upsert, delete |

---

## Switching to DocDB

To switch from MySQL to DocDB, remove or change `DB_TYPE` in your `.env`:

```bash
# Option A: Remove DB_TYPE (defaults to docdb)
sed -i '' '/^DB_TYPE=/d' .env

# Option B: Set explicitly
echo 'DB_TYPE=docdb' >> .env
```

Ensure IMS S2S credentials are present in `.env`. See [DOCDB_README.md](DOCDB_README.md) for details.
