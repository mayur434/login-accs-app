const libDB = require('@adobe/aio-lib-db')
const { normalizeMobile } = require('../../utils')

const DEFAULT_OTP_EXPIRATION_VALIDITY_MINUTES = 5
const DEFAULT_OTP_IN_RESPONSE = false

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== ''
}

function response(statusCode, error) {
  return { statusCode, body: { error } }
}

function generateOtpValue() {
  return (Math.floor(1000 + Math.random() * 9000)).toString()
}

function createReferenceId() {
  return `otp_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function levenshtein(a, b) {
  if (!a) return b ? b.length : 0
  if (!b) return a.length
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

async function connectDb(params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const token = params.AIO_DB_TOKEN
  if (!token) throw new Error('AIO_DB_TOKEN missing')

  const db = await libDB.init({ region, token })
  const dbClient = await db.connect()
  return dbClient
}

async function getAppConfig(dbClient, logger) {
  const appConfigCollection = await dbClient.collection('app_config')

  const defaults = {
    _id: 'app_config',
    is_enabled: true,
    otp_expiration_validity: DEFAULT_OTP_EXPIRATION_VALIDITY_MINUTES,
    otp_expiration_validity_minutes: DEFAULT_OTP_EXPIRATION_VALIDITY_MINUTES,
    otp_in_response: DEFAULT_OTP_IN_RESPONSE,
    allow_key_info_update: true
  }

  let doc = await findOneOrNull(appConfigCollection, {})

  if (!doc) {
    await appConfigCollection.insertOne(defaults)
    doc = defaults
  } else {
    const missing = {}
    if (typeof doc.is_enabled !== 'boolean') missing.is_enabled = false
    if (typeof doc.otp_expiration_validity === 'undefined') missing.otp_expiration_validity = false

    if (Object.keys(missing).length) {
      await appConfigCollection.updateOne(
        { _id: doc._id || 'default' },
        { $set: missing }
      )
      doc = { ...doc, ...missing }
    }
  }

  return doc
}
function isDocumentNotFoundError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase()
  return message.includes('document not found')
}

async function findOneOrNull(collection, query) {
  try {
    return await collection.findOne(query)
  } catch (error) {
    if (isDocumentNotFoundError(error)) return null
    throw error
  }
}

async function registrationUserExists(dbClient, params) {
  const identityCollection = await dbClient.collection('customer_mobile_identity')

  const emailInput = hasValue(params.email) ? String(params.email).trim().toLowerCase() : null
  const rawMobileInput = hasValue(params.mobile)
    ? String(params.mobile).trim()
    : (hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null)

  let normalizedMobile = rawMobileInput
  if (rawMobileInput) {
    try {
      normalizedMobile = normalizeMobile(rawMobileInput)
    } catch (_) {
      normalizedMobile = rawMobileInput
    }
  }

  let emailExists = false
  let mobileExists = false

  if (emailInput) {
    // check common email keys used in identity docs
    const byEmail =
      await findOneOrNull(identityCollection, { email: emailInput }) ||
      await findOneOrNull(identityCollection, { resolvedEmail: emailInput })
    emailExists = !!byEmail
  }

  if (rawMobileInput) {
    // check both mobile keys and both raw/normalized values
    const candidates = Array.from(new Set([rawMobileInput, normalizedMobile].filter(Boolean)))
    for (const m of candidates) {
      const byMobile =
        await findOneOrNull(identityCollection, { mobile: m }) ||
        await findOneOrNull(identityCollection, { mobile_number: m })
      if (byMobile) {
        mobileExists = true
        break
      }
    }
  }

  return {
    exists: emailExists || mobileExists,
    emailExists,
    mobileExists
  }
}

async function loginUserExists(dbClient, params) {
  const identityCollection = await dbClient.collection('customer_mobile_identity')
  const loginType = String(params.loginType || '').toLowerCase()

  const emailInput = hasValue(params.email) ? String(params.email).trim().toLowerCase() : null
  const rawMobileInput = hasValue(params.mobile)
    ? String(params.mobile).trim()
    : (hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null)

  if (loginType === 'mobile') {
    if (!rawMobileInput) return false

    let normalizedMobile = rawMobileInput
    try {
      normalizedMobile = normalizeMobile(rawMobileInput)
    } catch (_) { }

    const candidates = Array.from(new Set([rawMobileInput, normalizedMobile].filter(Boolean)))
    for (const m of candidates) {
      const byMobile =
        await findOneOrNull(identityCollection, { mobile_number: m, status: 'active' }) ||
        await findOneOrNull(identityCollection, { mobile: m, status: 'active' })
      if (byMobile) return true
    }
    return false
  }

  if (!emailInput) return false
  const byEmail =
    await findOneOrNull(identityCollection, { email: emailInput, status: 'active' }) ||
    await findOneOrNull(identityCollection, { resolvedEmail: emailInput, status: 'active' })
  return !!byEmail
}

async function handleOtp(params, operation, logger) {
  let dbClient
  try {
    dbClient = await connectDb(params)
    const otpCollection = await dbClient.collection('otps')
    const appConfig = await getAppConfig(dbClient)

    if (!(appConfig && appConfig.is_enabled)) {
      return { response: response(403, 'otp module is disabled') }
    }

    const isVerify = hasValue(params.otpReferenceId) && hasValue(params.otpValue)

    if (!isVerify) {
      if (!hasValue(params.loginType)) {
        return { response: response(400, "missing parameter(s) 'loginType'") }
      }

      if (String(params.loginType).toLowerCase() === 'mobile' && !hasValue(params.mobile) && !hasValue(params.mobile_number)) {
        return { response: response(400, "missing parameter(s) 'mobile'") }
      }

      if (String(params.loginType).toLowerCase() !== 'mobile' && !hasValue(params.email)) {
        return { response: response(400, "missing parameter(s) 'email'") }
      }

      if (operation === 'register') {
        const existence = await registrationUserExists(dbClient, params)
        if (existence.exists) {
          return {
            response: response(
              409,
              existence.emailExists && existence.mobileExists
                ? 'email/mobile already exists'
                : (existence.emailExists ? 'email already exists' : 'mobile already exists')
            )
          }
        }
      }

      if (operation === 'login') {
        const exists = await loginUserExists(dbClient, params)
        if (!exists) {
          return { response: response(404, 'user not found') }
        }
      }

      const otpValue = generateOtpValue()
      const ref = createReferenceId()
      const otpValidityMinutes = Number.isInteger(appConfig.otp_expiration_validity) && appConfig.otp_expiration_validity > 0
        ? appConfig.otp_expiration_validity
        : DEFAULT_OTP_EXPIRATION_VALIDITY_MINUTES

      const otpInResponse = typeof appConfig.otp_in_response === 'boolean'
        ? appConfig.otp_in_response
        : DEFAULT_OTP_IN_RESPONSE

      await otpCollection.insertOne({
        otpReferenceId: ref,
        otp: otpValue,
        operation,
        loginType: params.loginType,
        mobile: params.mobile || params.mobile_number || null,
        email: params.email || null,
        customer_id: params.customer_id || null,

        // add name persistence
        firstname: params.firstname || params.firstName || null,
        firstName: params.firstName || params.firstname || null,
        lastname: params.lastname || params.lastName || null,
        lastName: params.lastName || params.lastname || null,

        createdAt: Date.now(),
        expiresAt: Date.now() + (otpValidityMinutes * 60 * 1000),
        otpExpirationValidityMinutes: otpValidityMinutes,
        consumed: false
      })

      return {
        response: {
          statusCode: 200,
          body: otpInResponse ? { otpReferenceId: ref, otpValue } : { otpReferenceId: ref }
        }
      }
    }

    const record = await otpCollection.findOne({ otpReferenceId: params.otpReferenceId })
    if (!record) return { response: response(400, 'invalid otpReferenceId') }
    if (record.consumed) return { response: response(400, 'otp already used') }

    if (Date.now() > record.expiresAt) {
      await otpCollection.deleteOne({ otpReferenceId: params.otpReferenceId })
      return { response: response(400, 'otp expired') }
    }

    if (record.operation !== operation) {
      return { response: response(400, `otp not valid for operation: ${operation}`) }
    }

    const distance = levenshtein(String(params.otpValue), String(record.otp))
    if (distance > 1) return { response: response(401, 'invalid otp') }

    await otpCollection.updateOne(
      { otpReferenceId: params.otpReferenceId },
      { $set: { consumed: true, consumedAt: Date.now() } }
    )

    return { verified: true, record }
  } catch (e) {
    logger.error(e)
    return { response: response(500, e.message || 'server error') }
  } finally {
    try {
      if (dbClient) await dbClient.close()
    } catch (e) {
      logger.debug && logger.debug(`error closing DB client: ${e.message}`)
    }
  }
}

module.exports = { handleOtp }