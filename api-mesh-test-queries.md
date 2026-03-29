# API Mesh Test Queries — Login Module

GraphQL mutations for testing the API Mesh endpoint. The mesh auto-generates these
from the OpenAPI spec (`mesh/openapi.json`).

## Mesh Setup

| Source | Handler | Description |
|---|---|---|
| **Commerce** | `graphql` | Adobe Commerce GraphQL passthrough |
| **LoginModule** | `openapi` | OTP + Customer actions via `openapi.json` |

**Operations exposed by the LoginModule source:**

| Mutation | Upstream | Description |
|---|---|---|
| `otpAction` | `POST /otp` | Generate or validate OTP |
| `customerAction` | `POST /customer` | Register, login, or update customer profile |

> **Config actions** (`getConfig`, `updateConfig`, `deleteConfig`) are **NOT** in the mesh.
> They are admin-only and called directly from the Admin UI SDK.

## Getting the Mesh Endpoint

```bash
cd mesh && npm run get
```

The output shows your mesh GraphQL URL (e.g. `https://<mesh-id>.adobeioruntime.net/graphql`).

---

# 1. OTP Flow (via `otpAction`)

## 1.1 Generate OTP — mobile

```graphql
mutation GenerateOtpMobile {
  otpAction(input: {
    loginType: "mobile"
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
    loginType: "email"
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
    loginType: "mobile"
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
    loginType: "mobile"
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
    loginType: "email"
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

## 2.1 Register — Step 1: Request OTP

```graphql
mutation RegisterStep1 {
  customerAction(input: {
    operation: "register"
    loginType: "mobile"
    mobile: "9876543210"
    firstname: "John"
    lastname: "Doe"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 2.2 Register — Step 2: Validate OTP & Complete

```graphql
mutation RegisterStep2 {
  customerAction(input: {
    operation: "register"
    loginType: "mobile"
    mobile: "9876543210"
    otpReferenceId: "paste-reference-id-here"
    otpValue: "paste-otp-here"
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

## 2.3 Login — Step 1: Request OTP

```graphql
mutation LoginStep1 {
  customerAction(input: {
    operation: "login"
    loginType: "mobile"
    mobile: "9876543210"
  }) {
    otpReferenceId
    otpValue
  }
}
```

## 2.4 Login — Step 2: Validate OTP & Get Token

```graphql
mutation LoginStep2 {
  customerAction(input: {
    operation: "login"
    loginType: "mobile"
    otpReferenceId: "paste-reference-id-here"
    otpValue: "paste-otp-here"
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

## 2.5 Update Customer — Mobile Number

```graphql
mutation UpdateMobile {
  customerAction(input: {
    operation: "updateCustomerDetails"
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

## 2.6 Update Customer — Email

```graphql
mutation UpdateEmail {
  customerAction(input: {
    operation: "updateCustomerDetails"
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

## 2.7 Update Customer — Mobile + Email

```graphql
mutation UpdateBoth {
  customerAction(input: {
    operation: "updateCustomerDetails"
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

# 3. Commerce Passthrough

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

# 4. Quick Copy-Paste Flows

## Flow A: Existing Customer Login

### Step 1 — Generate OTP

```graphql
mutation {
  otpAction(input: { loginType: "mobile", mobile: "9876543210" }) {
    otpReferenceId
    otpValue
  }
}
```

### Step 2 — Validate OTP

```graphql
mutation {
  otpAction(input: {
    loginType: "mobile"
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
    operation: "register"
    loginType: "mobile"
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
    operation: "register"
    loginType: "mobile"
    mobile: "9876543210"
    otpReferenceId: "paste-ref-here"
    otpValue: "paste-otp-here"
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
  customerAction(input: { operation: "login", loginType: "email", email: "john@example.com" }) {
    otpReferenceId
    otpValue
  }
}
```

### Step 2 — Validate & Login

```graphql
mutation {
  customerAction(input: {
    operation: "login"
    loginType: "email"
    otpReferenceId: "paste-ref-here"
    otpValue: "paste-otp-here"
  }) {
    success
    customerToken
    customer { id firstname lastname email }
  }
}
```

---

# 5. Troubleshooting

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
  }
}
```

## Response field names

Use the Mesh playground explorer to see the exact auto-generated response type fields.
Key differences between operations:

| Operation | Token field | Customer ID field |
|---|---|---|
| Register | `customer_token` | `customer.customer_id` |
| Login | `customerToken` | `customer.id` |
| Update | — | `customer.customer_id` |

## Mesh not returning data

1. Confirm mesh is deployed: `cd mesh && npm run get`
2. Verify `ACTION_BASE_URL` in `.env.mesh` points to deployed actions (not localhost)
3. Re-deploy mesh after URL change: `npm run update`

