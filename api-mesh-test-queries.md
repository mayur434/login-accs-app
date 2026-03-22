# Adobe API Mesh Test Queries for Custom Login App

This file lists example GraphQL operations you can use to test the Adobe API Mesh source built from the OpenAPI schema.

## Assumptions

These examples assume your OpenAPI source uses these `operationId` values:

- `invokeOtp`
- `invokeCustomer`
- `getConfig`
- `saveConfig`
- `replaceConfig`
- `patchConfig`
- `deleteConfig`

They also assume API Mesh generated GraphQL fields directly from those operation IDs.

## Important note before testing

Depending on your API Mesh/OpenAPI generation, the request body may be exposed in one of these two shapes:

### Shape A

```graphql
mutation {
  invokeOtp(input: {
    loginType: "mobile"
    mobile: "9876543210"
  }) {
    success
  }
}
```

### Shape B

```graphql
mutation {
  invokeOtp(body: {
    loginType: "mobile"
    mobile: "9876543210"
  }) {
    success
  }
}
```

In most setups, `input` is the common shape. If `input` does not work in your Mesh explorer, try `body`.

---

# 1. OTP Flow

## 1.1 Generate OTP using mobile

```graphql
mutation GenerateOtpMobile {
  invokeOtp(input: {
    loginType: "mobile"
    mobile: "9876543210"
  }) {
    success
    message
    otpReferenceId
    otpValue
    customer_token
    customer_id
  }
}
```

## 1.2 Generate OTP using email

```graphql
mutation GenerateOtpEmail {
  invokeOtp(input: {
    loginType: "email"
    email: "john@example.com"
  }) {
    success
    message
    otpReferenceId
    otpValue
    customer_token
    customer_id
  }
}
```

## 1.3 Validate OTP for existing mobile customer

```graphql
mutation ValidateOtpMobile {
  invokeOtp(input: {
    loginType: "mobile"
    otpReferenceId: "otp_1711017600000_12345"
    otpValue: "4821"
  }) {
    success
    message
    customer_token
    customer_id
  }
}
```

## 1.4 Validate OTP for existing email customer

```graphql
mutation ValidateOtpEmail {
  invokeOtp(input: {
    loginType: "email"
    otpReferenceId: "otp_1711017600000_12345"
    otpValue: "4821"
  }) {
    success
    message
    customer_token
    customer_id
  }
}
```

## 1.5 Validate OTP with auto-register

```graphql
mutation ValidateOtpAutoRegister {
  invokeOtp(input: {
    loginType: "mobile"
    otpReferenceId: "otp_1711017600000_12345"
    otpValue: "4821"
    register: true
  }) {
    success
    message
    customer_token
    customer_id
  }
}
```

---

# 2. Customer Flow

## 2.1 Request OTP for registration

Use this to start registration and generate OTP.

```graphql
mutation RequestRegistrationOtp {
  invokeCustomer(input: {
    operation: "register"
    loginType: "mobile"
    firstname: "John"
    lastname: "Doe"
    email: "john@example.com"
    mobile: "9876543210"
  }) {
    success
    message
    otpReferenceId
    otpValue
    customer_id
    customer_token
  }
}
```

## 2.2 Verify OTP and complete registration

```graphql
mutation CompleteRegistration {
  invokeCustomer(input: {
    operation: "register"
    loginType: "mobile"
    firstname: "John"
    lastname: "Doe"
    email: "john@example.com"
    mobile: "9876543210"
    otpReferenceId: "otp_1711017600000_12345"
    otpValue: "4821"
  }) {
    success
    message
    customer_id
    customer_token
    customer
  }
}
```

## 2.3 Update full customer profile

```graphql
mutation UpdateCustomerFull {
  invokeCustomer(input: {
    operation: "updateCustomerDetails"
    customer_token: "customer_token_here"
    new_email: "john.new@example.com"
    new_mobile: "9988776655"
    new_firstname: "Johnathan"
    new_lastname: "Doe"
  }) {
    success
    message
    customer_id
    customer
  }
}
```

## 2.4 Update mobile only

```graphql
mutation UpdateCustomerMobileOnly {
  invokeCustomer(input: {
    operation: "updateCustomerDetails"
    customer_token: "customer_token_here"
    new_mobile: "9988776655"
  }) {
    success
    message
    customer_id
    customer
  }
}
```

## 2.5 Update name only

```graphql
mutation UpdateCustomerNameOnly {
  invokeCustomer(input: {
    operation: "updateCustomerDetails"
    customer_token: "customer_token_here"
    new_firstname: "Johnathan"
    new_lastname: "Doe"
  }) {
    success
    message
    customer_id
    customer
  }
}
```

## 2.6 Update email only

```graphql
mutation UpdateCustomerEmailOnly {
  invokeCustomer(input: {
    operation: "updateCustomerDetails"
    customer_token: "customer_token_here"
    new_email: "john.new@example.com"
  }) {
    success
    message
    customer_id
    customer
  }
}
```

---

# 3. Config Flow

## 3.1 Get config

```graphql
query GetConfig {
  getConfig {
    otp_expiration_validity
    otp_in_response
    auto_login
  }
}
```

## 3.2 Save config using POST

```graphql
mutation SaveConfig {
  saveConfig(input: {
    otp_expiration_validity: 300
    otp_in_response: true
    auto_login: true
  }) {
    otp_expiration_validity
    otp_in_response
    auto_login
  }
}
```

## 3.3 Replace config using PUT

```graphql
mutation ReplaceConfig {
  replaceConfig(input: {
    otp_expiration_validity: 600
    otp_in_response: false
    auto_login: true
  }) {
    otp_expiration_validity
    otp_in_response
    auto_login
  }
}
```

## 3.4 Patch config using PATCH

```graphql
mutation PatchConfig {
  patchConfig(input: {
    otp_in_response: true
  }) {
    otp_expiration_validity
    otp_in_response
    auto_login
  }
}
```

## 3.5 Delete config

```graphql
mutation DeleteConfig {
  deleteConfig {
    success
    message
  }
}
```

---

# 4. Quick copy-paste test order

## Existing customer login

### Step 1: Generate OTP

```graphql
mutation {
  invokeOtp(input: {
    loginType: "mobile"
    mobile: "9876543210"
  }) {
    success
    message
    otpReferenceId
    otpValue
  }
}
```

### Step 2: Validate OTP

```graphql
mutation {
  invokeOtp(input: {
    loginType: "mobile"
    otpReferenceId: "paste-reference-id-here"
    otpValue: "paste-otp-here"
  }) {
    success
    message
    customer_token
    customer_id
  }
}
```

## New customer registration

### Step 1: Request registration OTP

```graphql
mutation {
  invokeCustomer(input: {
    operation: "register"
    loginType: "mobile"
    firstname: "John"
    lastname: "Doe"
    email: "john@example.com"
    mobile: "9876543210"
  }) {
    success
    message
    otpReferenceId
    otpValue
  }
}
```

### Step 2: Complete registration

```graphql
mutation {
  invokeCustomer(input: {
    operation: "register"
    loginType: "mobile"
    firstname: "John"
    lastname: "Doe"
    email: "john@example.com"
    mobile: "9876543210"
    otpReferenceId: "paste-reference-id-here"
    otpValue: "paste-otp-here"
  }) {
    success
    message
    customer_id
    customer_token
  }
}
```

---

# 5. Troubleshooting

## If `input` fails

Try replacing `input` with `body`:

```graphql
mutation {
  invokeOtp(body: {
    loginType: "mobile"
    mobile: "9876543210"
  }) {
    success
    otpReferenceId
  }
}
```

## If response field names differ

Run GraphQL introspection in Mesh playground and verify:

- mutation field names
- argument name: `input` or `body`
- response fields like `customer_token` vs `token`

## If `/config` fields are scalar/object-mapped differently

Select the fields shown in the explorer instead of forcing the exact field list above.

