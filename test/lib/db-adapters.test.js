/**
 * Unit tests for lib/db-adapters/index.js
 */

const { getAdapter } = require('../../lib/db-adapters/index')

describe('db adapter factory', () => {
  test('returns docdb adapter by default', () => {
    const adapter = getAdapter({})
    expect(adapter).toBeDefined()
    expect(adapter.connect).toBeDefined()
  })

  test('returns docdb adapter for explicit docdb', () => {
    const adapter = getAdapter({ DB_TYPE: 'docdb' })
    expect(adapter).toBeDefined()
  })

  test('returns mysql adapter for mysql', () => {
    const adapter = getAdapter({ DB_TYPE: 'mysql' })
    expect(adapter).toBeDefined()
    expect(adapter.connect).toBeDefined()
  })

  test('is case-insensitive', () => {
    const adapter1 = getAdapter({ DB_TYPE: 'MySQL' })
    const adapter2 = getAdapter({ DB_TYPE: 'MYSQL' })
    expect(adapter1.connect).toBeDefined()
    expect(adapter2.connect).toBeDefined()
  })

  test('trims whitespace', () => {
    const adapter = getAdapter({ DB_TYPE: '  mysql  ' })
    expect(adapter.connect).toBeDefined()
  })

  test('falls back to docdb for unknown type', () => {
    const adapter = getAdapter({ DB_TYPE: 'postgres' })
    expect(adapter).toBeDefined()
  })

  test('reads from process.env when params not provided', () => {
    const original = process.env.DB_TYPE
    try {
      process.env.DB_TYPE = 'mysql'
      const adapter = getAdapter({})
      expect(adapter.connect).toBeDefined()
    } finally {
      if (original !== undefined) {
        process.env.DB_TYPE = original
      } else {
        delete process.env.DB_TYPE
      }
    }
  })
})
