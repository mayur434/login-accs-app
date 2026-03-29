/**
 * Shared template resolution utility.
 *
 * Replaces {{KEY}} placeholders in a template string with supplied values.
 */

function resolveTemplate (template, vars) {
  let result = template || ''
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value))
  }
  return result
}

module.exports = { resolveTemplate }
