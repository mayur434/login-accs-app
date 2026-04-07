# API Mesh Test Queries — Login Module

GraphQL mutations and queries for testing the API Mesh endpoint. The mesh auto-generates
these from the OpenAPI spec (`mesh/openapi.json`).

## Mesh Setup

| Source | Handler | Description |
|---|---|---|
| **Commerce** | `graphql` | Adobe Commerce GraphQL passthrough |
| **LoginModule** | `openapi` | OTP, Customer, Config, Init-Identity via `openapi.json` |

**Operations exposed by the LoginModule source:**

| Type | Operation | Upstream | Description |
|---|---|---|---|
| Mutation | `otpAction` | `POST /otp` | Generate or validate OTP |
| Mutation | `customerAction` | `POST /customer` | Register, login, or update customer |
| Query | `getConfig` | `GET /config` | Read admin configuration |
| Mutation | `updateConfig` | `POST /config` | Update admin configuration |
| Mutation | `deleteConfig` | `DELETE /config` | Reset config to defaults |
| Mutation | `initIdentity` | `POST /init-identity` | Initialize identity collection + indexes |

## Getting the Mesh Endpoint

```bash
cd mesh && npm run get
```

---

# 1. OTP Flow (via `otpAction`)

`loginType` is inferred internally from the identifier fields you send. Use `mobile` for mobile OTP and `email` for email OTP; OTP validation only needs `otpReferenceId` and `otpValue`.

## 1.1 Generate OTP — mobile

```graphql
mutation GenerateOtpMobile {
  otpAction(input: {
    mobile: "9876543210"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 1.2 Generate OTP — email

```graphql
mutation GenerateOtpEmail {
  otpAction(input: {
    email: "john@example.com"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 1.3 Generate OTP for registration

```graphql
mutation GenerateOtpRegister {
  otpAction(input: {
    mobile: "9876543210"
    firstname: "John"
    lastname: "Doe"
    register: true
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 1.4 Validate OTP — mobile

```graphql
mutation ValidateOtpMobile {
  otpAction(input: {
    otpReferenceId: "otp_1711017600000_12345"
    otpValue: "4821"
  }) {
    success
    customer_token
    message
  }
}
```

## 1.5 Validate OTP — email

```graphql
mutation ValidateOtpEmail {
  otpAction(input: {
    loginType: email
    otpReferenceId: "otp_1711017600000_12345"
    otpValue: "4821"
  }) {
    success
    customer_token
    message
  }
}
```

---

# 2. Customer Flow (via `customerAction`)

## 2.1 Register — Step 1: Request OTP (Mobile)

```graphql
mutation RegisterStep1Mobile {
  customerAction(input: {
    operation: register
    loginType: mobile
    mobile: "9876543210"
    firstname: "John"
    lastname: "Doe"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 2.2 Register — Step 1: Request OTP (Email)

```graphql
mutation RegisterStep1Email {
  customerAction(input: {
    operation: register
    loginType: email
    email: "john@example.com"
    firstname: "John"
    lastname: "Doe"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 2.3 Register — Step 2: Validate OTP & Complete

```graphql
mutation RegisterStep2 {
  customerAction(input: {
    operation: register
    otpReferenceId: "paste-reference-id-here"
    otpValue: "paste-otp-here"
    password: "YourP@ssword1"
  }) {
    success
    customer_token
    customer {
      customer_id
      firstname
      lastname
      email
      mobile_number
      login_type
    }
  }
}
```

## 2.4 Login — Step 1: Request OTP (Mobile)

```graphql
mutation LoginStep1Mobile {
  customerAction(input: {
    operation: login
    loginType: mobile
    mobile: "9876543210"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 2.5 Login — Step 1: Request OTP (Email)

```graphql
mutation LoginStep1Email {
  customerAction(input: {
    operation: login
    loginType: email
    email: "john@example.com"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 2.6 Login — Step 2: Validate OTP & Get Token

```graphql
mutation LoginStep2 {
  customerAction(input: {
    operation: login
    otpReferenceId: "paste-reference-id-here"
    otpValue: "paste-otp-here"
    password: "YourP@ssword1"
  }) {
    success
    customerToken
    customer {
      id
      firstname
      lastname
      email
    }
  }
}
```

## 2.7 Update Customer — Mobile Number

```graphql
mutation UpdateMobile {
  customerAction(input: {
    operation: updateCustomerDetails
    customer_token: "paste-customer-token-here"
    customer_id: 42
    mobile_number: "9988776655"
  }) {
    success
    customer {
      customer_id
      mobile_number
      email
      login_type
      status
    }
  }
}
```

## 2.8 Update Customer — Email

```graphql
mutation UpdateEmail {
  customerAction(input: {
    operation: updateCustomerDetails
    customer_token: "paste-customer-token-here"
    customer_id: 42
    new_email: "john.new@example.com"
  }) {
    success
    customer {
      customer_id
      email
      mobile_number
      login_type
      status
    }
  }
}
```

## 2.9 Update Customer — Mobile + Email

```graphql
mutation UpdateBoth {
  customerAction(input: {
    operation: updateCustomerDetails
    customer_token: "paste-customer-token-here"
    customer_id: 42
    mobile_number: "9988776655"
    new_email: "john.new@example.com"
  }) {
    success
    customer {
      customer_id
      mobile_number
      email
      login_type
      status
    }
  }
}
```

---

# 3. Admin Config (via `getConfig` / `updateConfig` / `deleteConfig`)

## 3.1 Read Config

```graphql
query ReadConfig {
  getConfig {
    is_enabled
    otp_expiration_validity
    otp_in_response
    auto_register
    allow_key_info_update
    sms_api_host
    sms_endpoint
    sms_api_key
    sms_template_enabled
    sms_template_id
    sms_template_string
    email_smtp_host
    email_smtp_port
    email_smtp_user
    email_smtp_password
    email_from_address
    email_from_name
    email_template_enabled
    email_template_id
    email_template_string
    updatedAt
  }
}
```

## 3.2 Update Config — Core Settings

```graphql
mutation UpdateCoreConfig {
  updateConfig(input: {
    is_enabled: true
    otp_in_response: true
    auto_register: true
    allow_key_info_update: true
    otp_expiration_validity: 5
  }) {
    is_enabled
    otp_in_response
    auto_register
    allow_key_info_update
    otp_expiration_validity
    updatedAt
  }
}
```

## 3.3 Update Config — SMS Settings

```graphql
mutation UpdateSmsConfig {
  updateConfig(input: {
    sms_api_host: "https://api.sms-provider.com"
    sms_endpoint: "/v1/send"
    sms_api_key: "your-api-key"
    sms_template_enabled: true
    sms_template_id: "tmpl-123"
    sms_template_string: "Your OTP is {{otp}}, valid for {{minutes}} minutes."
  }) {
    sms_api_host
    sms_endpoint
    sms_template_enabled
    updatedAt
  }
}
```

## 3.4 Update Config — Email Settings

```graphql
mutation UpdateEmailConfig {
  updateConfig(input: {
    email_smtp_host: "smtp.example.com"
    email_smtp_port: 587
    email_smtp_user: "noreply@example.com"
    email_smtp_password: "smtp-password"
    email_from_address: "noreply@example.com"
    email_from_name: "My Store"
    email_template_enabled: true
    email_template_string: "Your OTP is {{otp}}. Valid for {{minutes}} min."
  }) {
    email_smtp_host
    email_from_address
    email_template_enabled
    updatedAt
  }
}
```

## 3.5 Reset Config (Delete)

```graphql
mutation ResetConfig {
  deleteConfig {
    success
    message
  }
}
```

---

# 4. Init Identity

```graphql
mutation InitIdentity {
  initIdentity {
    success
    collection
    indexes
  }
}
```

---

# 5. Commerce Passthrough

The mesh also proxies the full Commerce GraphQL schema. Example:

```graphql
query CommerceProducts {
  products(search: "shirt", pageSize: 3) {
    items {
      name
      sku
      price_range {
        minimum_price {
          final_price { value currency }
        }
      }
    }
  }
}
```

---

# 6. Quick Copy-Paste Flows

## Flow A: Existing Customer Login

### Step 1 — Generate OTP

```graphql
mutation {
  otpAction(input: { loginType: mobile, mobile: "9876543210" }) {
    otpReferenceId
    otpValue
  }
}
```

### Step 2 — Validate OTP

```graphql
mutation {
  otpAction(input: {
    loginType: mobile
    otpReferenceId: "paste-ref-here"
    otpValue: "paste-otp-here"
  }) {
    success
    customer_token
    message
  }
}
```

## Flow B: New Customer Registration (via customerAction)

### Step 1 — Request Registration OTP

```graphql
mutation {
  customerAction(input: {
    operation: register
    loginType: mobile
    mobile: "9876543210"
    firstname: "John"
    lastname: "Doe"
  }) {
    otpReferenceId
    otpValue
  }
}
```

### Step 2 — Complete Registration

```graphql
mutation {
  customerAction(input: {
    operation: register
    otpReferenceId: "paste-ref-here"
    otpValue: "paste-otp-here"
    password: "YourP@ssword1"
  }) {
    success
    customer_token
    customer { customer_id firstname lastname email mobile_number login_type }
  }
}
```

## Flow C: Login via customerAction (with auto-register)

### Step 1 — Request Login OTP

```graphql
mutation {
  customerAction(input: { operation: login, loginType: email, email: "john@example.com" }) {
    otpReferenceId
    otpValue
  }
}
```

### Step 2 — Validate & Login

```graphql
mutation {
  customerAction(input: {
    operation: login
    otpReferenceId: "paste-ref-here"
    otpValue: "paste-otp-here"
    password: "YourP@ssword1"
  }) {
    success
    customerToken
    customer { id firstname lastname email }
  }
}
```

---

# 7. Troubleshooting

## Input argument name

The OpenAPI handler may generate the argument as `input` or `otpActionInput` / `customerActionInput`
depending on the API Mesh version. Run introspection to check:

```graphql
{
  __schema {
    mutationType {
      fields {
        name
        args { name type { name } }
      }
    }
    queryType {
      fields {
        name
        args { name type { name } }
      }
    }
  }
}
```

## Response field names

| Operation | Token field | Customer ID field |
|---|---|---|
| Register | `customer_token` | `customer.customer_id` |
| Login | `customerToken` | `customer.id` |
| Update | — | `customer.customer_id` |

## Mesh not returning data

1. Confirm mesh is deployed: `cd mesh && npm run get`
2. Verify `ACTION_BASE_URL` in `.env.mesh` points to deployed runtime actions (`.adobeioruntime.net`, NOT `.adobeio-static.net`)
3. Re-deploy mesh after URL change: `npm run update`
