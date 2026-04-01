/**
 * Shared template resolution utility.
 *
 * Replaces {{KEY}} placeholders in a template string with supplied values.
 * Matching is case-insensitive so {{otp}}, {{OTP}}, {{Otp}} all work.
 */

function resolveTemplate (template, vars) {
  let result = template || ''
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}', 'gi'), String(value))
  }
  return result
}

module.exports = { resolveTemplate }
