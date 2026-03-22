const ACTION_BASE_URL = "https://localhost:9080/api/v1/web/login-module"

function safeGet(obj, path) {
  let current = obj
  for (let i = 0; i < path.length; i++) {
    if (!current || typeof current !== "object") return undefined
    current = current[path[i]]
  }
  return current
}

function getHeaders(context, includeJson) {
  const headers = {}
  if (includeJson) headers["content-type"] = "application/json"

  return headers
}

async function parseResponse(res) {
  const text = await res.text()
  let json = {}

  try {
    json = text ? JSON.parse(text) : {}
  } catch (e) {
    throw new Error("Invalid JSON response: " + text)
  }

  if (!res.ok) {
    const message =
      safeGet(json, ["error", "body", "message"]) ||
      safeGet(json, ["body", "message"]) ||
      json.message ||
      ("Request failed with status " + res.status)

    throw new Error(message)
  }

  return json.body || json
}

async function callAction(path, method, context, body) {
  // Ensure no double slashes in URL
  const url = ACTION_BASE_URL + (path.startsWith("/") ? path : "/" + path)
  const options = {
    method,
    headers: getHeaders(context, true)
  }

  if (body && method !== "GET" && method !== "DELETE") {
    options.body = JSON.stringify(body)
  }

  console.log(`[Mesh Resolver] Calling action:`, { url, method, body, headers: options.headers })
  try {
    const res = await fetch(url, options)
    const parsed = await parseResponse(res)
    console.log(`[Mesh Resolver] Response from action:`, parsed)
    return parsed
  } catch (err) {
    console.error(`[Mesh Resolver] Error calling action:`, err)
    throw err
  }
}

function normalizeConfigResponse(data, fallbackMessage) {
  return {
    success: typeof data.success === "boolean" ? data.success : true,
    message: data.message || fallbackMessage,
    config: data.config || data || null
  }
}

function normalizeCustomer(customer, root) {
  if (customer) {
    return {
      id: customer.id || customer.customer_id || null,
      firstname: customer.firstname || null,
      lastname: customer.lastname || null,
      email: customer.email || null,
      mobile: customer.mobile || null
    }
  }

  if (root && (root.customer_id || root.customerId)) {
    return {
      id: root.customer_id || root.customerId || null,
      firstname: null,
      lastname: null,
      email: null,
      mobile: null
    }
  }

  return null
}

module.exports = {
  resolvers: {
    Query: {
      getConfig: {
        resolve: async function (_, args, context) {
          const data = await callAction("/config", "GET", context)
          return normalizeConfigResponse(data, "config fetched successfully")
        }
      }
    },
    Mutation: {
      updateConfig: {
        resolve: async function (_, args, context) {
          const data = await callAction("/config", "POST", context, args.input)
          return normalizeConfigResponse(data, "config updated successfully")
        }
      },

      deleteConfig: {
        resolve: async function (_, args, context) {
          const data = await callAction("/config", "DELETE", context)
          return {
            success: typeof data.success === "boolean" ? data.success : true,
            message: data.message || "config deleted successfully"
          }
        }
      },

      generateOtp: {
        resolve: async function (_, args, context) {
          const data = await callAction("/otp", "POST", context, args.input)
          return {
            success: typeof data.success === "boolean" ? data.success : true,
            message: data.message || "otp generated",
            otpReferenceId: data.otpReferenceId || null,
            otpValue: data.otpValue || null
          }
        }
      },

      validateOtp: {
        resolve: async function (_, args, context) {
          const data = await callAction("/otp", "POST", context, args.input)
          return {
            success: typeof data.success === "boolean" ? data.success : true,
            message: data.message || "otp matched",
            customer_token: data.customer_token || data.token || null,
            customer_id: data.customer_id || data.customerId || null
          }
        }
      },

      registerCustomer: {
        resolve: async function (_, args, context) {
          const payload = Object.assign({ operation: "register" }, args.input)
          const data = await callAction("/customer", "POST", context, payload)

          return {
            success: typeof data.success === "boolean" ? data.success : true,
            message: data.message || "customer registered successfully",
            customer_id: data.customer_id || data.customerId || null,
            customer_token: data.customer_token || data.token || null,
            customer: normalizeCustomer(data.customer, data)
          }
        }
      },

      updateCustomerDetails: {
        resolve: async function (_, args, context) {
          const payload = Object.assign({ operation: "updateCustomerDetails" }, args.input)
          const data = await callAction("/customer", "POST", context, payload)

          return {
            success: typeof data.success === "boolean" ? data.success : true,
            message: data.message || "customer updated successfully",
            customer_id: data.customer_id || data.customerId || null,
            customer: normalizeCustomer(data.customer, data)
          }
        }
      }
    }
  }
}