/**
 * Database adapter factory.
 *
 * Selects the concrete adapter based on the DB_TYPE environment variable
 * (or the params.DB_TYPE override).
 *
 * Supported values:
 *   'docdb'  (default) — Adobe Doc DB via @adobe/aio-lib-db
 *   'mysql'            — MySQL via mysql2
 */

function getAdapter (params) {
  const dbType = (params?.DB_TYPE || process.env.DB_TYPE || 'docdb').toLowerCase().trim()

  switch (dbType) {
    case 'mysql':
      return require('./mysql-adapter')
    case 'docdb':
    default:
      return require('./docdb-adapter')
  }
}

module.exports = { getAdapter }
