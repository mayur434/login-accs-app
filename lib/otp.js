/**
 * Shared OTP generation and validation helpers.
 */

const crypto = require('crypto')

function generateOtpValue () {
  // 6-digit OTP (100000–999999) for production security. Configurable via env.
  const otpLength = Number(process.env.OTP_LENGTH) || 6
  const min = Math.pow(10, otpLength - 1)
  const max = Math.pow(10, otpLength)
  return crypto.randomInt(min, max).toString()
}

function createReferenceId () {
  return `otp_${Date.now()}_${crypto.randomInt(100000)}`
}

/**
 * Levenshtein edit-distance between two strings.
 */
function levenshtein (a, b) {
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

module.exports = { generateOtpValue, createReferenceId, levenshtein }
