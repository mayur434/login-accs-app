# API Mesh — GraphQL Queries

Verified against the live mesh introspection schema.

**Mesh endpoint (local):** `http://localhost:5000/graphql`
**Mesh endpoint (deployed):** Run `cd mesh && npm run get` to get the URL.

---

## Operations Available

### Mutations

| Mutation | Input Type | Description |
|---|---|---|
| `otpAction` | `OtpRequest_Input` | Generate or validate OTP |
| `customerAction` | `CustomerRequest_Input` | Register, login, or update customer |
| `updateConfig` | `ConfigUpdateRequest_Input` | Update admin configuration |
| `deleteConfig` | _(none)_ | Reset config to defaults |
| `initIdentity` | _(none)_ | Initialize identity collection + indexes |

### Queries

| Query | Return Type | Description |
|---|---|---|
| `getConfig` | `AppConfig` | Read current admin configuration |

### Enum Values

| Enum | Values |
|---|---|
| `loginType` | `email`, `mobile` (no quotes — these are enums) |
| `operation` | `register`, `login`, `updateCustomerDetails` |

---

## 1. OTP Flow

### 1.1 Generate OTP — Mobile

```graphql
mutation {
  otpAction(input: { loginType: mobile, mobile: "9876543210" }) {
    otpReferenceId
    otpValue
  }
}
```

### 1.2 Generate OTP — Email

```graphql
mutation {
  otpAction(input: { loginType: email, email: "john@example.com" }) {
    otpReferenceId
    otpValue
  }
}
```

### 1.3 Generate OTP — For Registration

```graphql
mutation {
  otpAction(input: {
    loginType: mobile,
    mobile: "9876543210",
    firstname: "John",
    lastname: "Doe",
    register: true
  }) {
    otpReferenceId
    otpValue
  }
}
```

### 1.4 Validate OTP — Mobile

```graphql
mutation {
  otpAction(input: {
    loginType: mobile,
    otpReferenceId: "PASTE_REF_HERE",
    otpValue: "PASTE_OTP_HERE"
  }) {
    success
    customer_token
    message
  }
}
```

### 1.5 Validate OTP — Email

```graphql
mutation {
  otpAction(input: {
    loginType: email,
    otpReferenceId: "PASTE_REF_HERE",
    otpValue: "PASTE_OTP_HERE"
  }) {
    success
    customer_token
    message
  }
}
```

---

## 2. Customer Flow — Registration

### 2.1 Register Step 1 — Request OTP (Mobile)

```graphql
mutation {
  customerAction(input: {
    operation: register,
    loginType: mobile,
    mobile: "9876543210",
    firstname: "John",
    lastname: "Doe"
  }) {
    otpReferenceId
    otpValue
  }
}
```

### 2.2 Register Step 1 — Request OTP (Email)

```graphql
mutation {
  customerAction(input: {
    operation: register,
    loginType: email,
    email: "john@example.com",
    firstname: "John",
    lastname: "Doe"
  }) {
    otpReferenceId
    otpValue
  }
}
```

### 2.3 Register Step 2 — Validate OTP & Complete

```graphql
mutation {
  customerAction(input: {
    operation: register,
    otpReferenceId: "PASTE_REF_HERE",
    otpValue: "PASTE_OTP_HERE",
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

---

## 3. Customer Flow — Login

### 3.1 Login Step 1 — Request OTP (Mobile)

```graphql
mutation {
  customerAction(input: {
    operation: login,
    loginType: mobile,
    mobile: "9876543210"
  }) {
    otpReferenceId
    otpValue
  }
}
```

### 3.2 Login Step 1 — Request OTP (Email)

```graphql
mutation {
  customerAction(input: {
    operation: login,
    loginType: email,
    email: "john@example.com"
  }) {
    otpReferenceId
    otpValue
  }
}
```

### 3.3 Login Step 2 — Validate OTP & Get Token

```graphql
mutation {
  customerAction(input: {
    operation: login,
    otpReferenceId: "PASTE_REF_HERE",
    otpValue: "PASTE_OTP_HERE",
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

---

## 4. Customer Flow — Update Profile

### 4.1 Update Mobile Number

```graphql
mutation {
  customerAction(input: {
    operation: updateCustomerDetails,
    customer_token: "PASTE_TOKEN_HERE",
    customer_id: 42,
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

### 4.2 Update Email

```graphql
mutation {
  customerAction(input: {
    operation: updateCustomerDetails,
    customer_token: "PASTE_TOKEN_HERE",
    customer_id: 42,
    new_email: "new@example.com"
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

### 4.3 Update Mobile + Email

```graphql
mutation {
  customerAction(input: {
    operation: updateCustomerDetails,
    customer_token: "PASTE_TOKEN_HERE",
    customer_id: 42,
    mobile_number: "9988776655",
    new_email: "new@example.com"
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

## 5. Admin Config

### 5.1 Read Config

```graphql
query {
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

### 5.2 Update Config

```graphql
mutation {
  updateConfig(input: {
    is_enabled: true,
    otp_in_response: true,
    auto_register: true,
    otp_expiration_validity: 5
  }) {
    is_enabled
    otp_in_response
    auto_register
    otp_expiration_validity
    updatedAt
  }
}
```

### 5.3 Update SMS Settings

```graphql
mutation {
  updateConfig(input: {
    sms_api_host: "https://api.sms-provider.com",
    sms_endpoint: "/v1/send",
    sms_api_key: "your-api-key",
    sms_template_enabled: true,
    sms_template_id: "tmpl-123",
    sms_template_string: "Your OTP is {{otp}}, valid for {{minutes}} minutes."
  }) {
    sms_api_host
    sms_endpoint
    sms_template_enabled
    updatedAt
  }
}
```

### 5.4 Update Email Settings

```graphql
mutation {
  updateConfig(input: {
    email_smtp_host: "smtp.example.com",
    email_smtp_port: 587,
    email_smtp_user: "noreply@example.com",
    email_smtp_password: "smtp-password",
    email_from_address: "noreply@example.com",
    email_from_name: "My Store",
    email_template_enabled: true,
    email_template_string: "Your OTP is {{otp}}. Valid for {{minutes}} min."
  }) {
    email_smtp_host
    email_from_address
    email_template_enabled
    updatedAt
  }
}
```

### 5.5 Reset Config (Delete)

```graphql
mutation {
  deleteConfig {
    success
    message
  }
}
```

---

## 6. Init Identity

```graphql
mutation {
  initIdentity {
    success
    collection
    indexes
  }
}
```

---

## 7. Commerce Passthrough

The mesh also exposes the full Commerce GraphQL schema. Example:

```graphql
query {
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

## 8. Input / Response Reference

### OtpRequest_Input

| Field | Type | Description |
|---|---|---|
| `loginType` | `enum (email, mobile)` | Login channel |
| `email` | `EmailAddress` | Required when loginType = email |
| `mobile` | `String` | Required when loginType = mobile |
| `otpReferenceId` | `String` | For validation — from generate step |
| `otpValue` | `String` | For validation — OTP code |
| `firstname` | `String` | For registration flow |
| `lastname` | `String` | For registration flow |
| `register` | `Boolean` | Set true for registration OTP |
| `customer_id` | `Int` | Stored in OTP record for reference |

### OtpResponse

| Field | Type | Description |
|---|---|---|
| `otpReferenceId` | `String` | Reference ID (from generate) |
| `otpValue` | `String` | OTP code (if otp_in_response enabled) |
| `success` | `Boolean` | True on successful validation |
| `customer_token` | `String` | Commerce token (on validation) |
| `message` | `String` | Result message |

### CustomerRequest_Input

| Field | Type | Description |
|---|---|---|
| `operation` | `enum (register, login, updateCustomerDetails)` | **Required** |
| `loginType` | `enum (email, mobile)` | For register/login |
| `email` | `EmailAddress` | For register/login (email flow) |
| `mobile` | `String` | For register/login (mobile flow) |
| `mobile_number` | `String` | Alias for mobile; update field for updateCustomerDetails |
| `password` | `String` | Required for register step 2 / login step 2 |
| `otpReferenceId` | `String` | OTP reference from step 1 |
| `otpValue` | `String` | OTP code to validate |
| `firstname` | `String` | For registration |
| `lastname` | `String` | For registration |
| `customer_token` | `String` | For updateCustomerDetails |
| `customer_id` | `Int` | For updateCustomerDetails |
| `new_email` | `EmailAddress` | For updateCustomerDetails |

### CustomerResponse

| Field | Type | Description |
|---|---|---|
| `success` | `Boolean` | True on success |
| `customer_token` | `String` | Token from register |
| `customerToken` | `String` | Token from login |
| `message` | `String` | Result message |
| `otpReferenceId` | `String` | OTP ref (when OTP triggered) |
| `otpValue` | `String` | OTP code (if otp_in_response enabled) |
| `customer` | `Customer` | Customer profile object |

### Customer

| Field | Type | Description |
|---|---|---|
| `customer_id` | `Int` | From register/update |
| `id` | `Int` | From login (Commerce native) |
| `firstname` | `String` | |
| `lastname` | `String` | |
| `email` | `String` | |
| `mobile_number` | `String` | |
| `login_type` | `String` | email, mobile, or both |
| `status` | `String` | e.g. active |

### AppConfig

| Field | Type | Description |
|---|---|---|
| `is_enabled` | `Boolean` | OTP module enabled |
| `otp_expiration_validity` | `Int` | Minutes |
| `otp_in_response` | `Boolean` | Return OTP in response |
| `auto_register` | `Boolean` | Auto-create on login |
| `allow_key_info_update` | `Boolean` | Allow email/mobile updates |
| `sms_api_host` | `String` | SMS provider host |
| `sms_endpoint` | `String` | SMS send endpoint |
| `sms_api_key` | `String` | SMS API key |
| `sms_template_enabled` | `Boolean` | Use SMS template |
| `sms_template_id` | `String` | SMS template ID |
| `sms_template_string` | `String` | SMS template body |
| `email_smtp_host` | `String` | SMTP host |
| `email_smtp_port` | `Int` | SMTP port |
| `email_smtp_user` | `String` | SMTP user |
| `email_smtp_password` | `String` | SMTP password |
| `email_from_address` | `String` | From address |
| `email_from_name` | `String` | From display name |
| `email_template_enabled` | `Boolean` | Use email template |
| `email_template_id` | `String` | Email template ID |
| `email_template_string` | `String` | Email template body |
| `updatedAt` | `Int` | Unix timestamp |

---

## 9. Troubleshooting

### Run introspection

```graphql
{
  __schema {
    mutationType {
      fields {
        name
        args { name type { name kind ofType { name } } }
      }
    }
  }
}
```

### Token field names differ by operation

| Operation | Token Field | Customer ID Field |
|---|---|---|
| Register | `customer_token` | `customer.customer_id` |
| Login | `customerToken` | `customer.id` |
| Update | — | `customer.customer_id` |

### Mesh not returning data

1. Verify mesh is running: `cd mesh && npm run get`
2. Check `ACTION_BASE_URL` in `.env.mesh` points to deployed runtime actions (`.adobeioruntime.net`, NOT `.adobeio-static.net`)
3. Re-deploy mesh after URL change: `npm run update`
