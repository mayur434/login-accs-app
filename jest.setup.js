/*
* <license header>
*/

jest.setTimeout(10000)

beforeEach(() => {
  // Invalidate app_config cache between tests to prevent cross-test contamination
  const { invalidateAppConfigCache } = require('./actions/lib/db')
  invalidateAppConfigCache()
})
afterEach(() => { })
