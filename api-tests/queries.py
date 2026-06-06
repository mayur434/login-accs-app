"""
GraphQL query/mutation definitions for all API Mesh operations.
Covers LoginModule actions + Commerce proxy queries.
"""

# ═══════════════════════════════════════════════════════════════════════
# Config Operations (Admin)
# ═══════════════════════════════════════════════════════════════════════

GET_CONFIG = """
query GetConfig {
  getConfig {
    is_enabled
    otp_expiration_validity
    otp_in_response
    auto_register
    auto_login
    allow_key_info_update
    sms_api_host
    sms_endpoint
    sms_sender_id
    sms_type
    sms_fallback_enabled
    sms_ics_api_host
    sms_ics_endpoint
    sms_ics_sender
    sms_ics_urlshortening
    sms_template_enabled
    sms_template_id
    sms_template_string
    email_smtp_host
    email_smtp_port
    email_smtp_user
    email_from_address
    email_from_name
    email_subject
    email_template_enabled
    email_template_id
    email_template_string
    google_sso_enabled
    google_client_id
    perf_logging
    sms_api_key_configured
    sms_ics_password_configured
    email_smtp_password_configured
    google_client_secret_configured
  }
}
"""

UPDATE_CONFIG = """
mutation UpdateConfig($input: ConfigUpdateRequest_Input!) {
  updateConfig(input: $input) {
    is_enabled
    otp_expiration_validity
    otp_in_response
    auto_register
    auto_login
    google_sso_enabled
    perf_logging
  }
}
"""

DELETE_CONFIG = """
mutation DeleteConfig {
  deleteConfig {
    success
    message
  }
}
"""

# ═══════════════════════════════════════════════════════════════════════
# Init Identity (Admin — DB setup)
# ═══════════════════════════════════════════════════════════════════════

INIT_IDENTITY = """
mutation InitIdentity {
  initIdentity {
    success
    collection
    indexes
  }
}
"""

# ═══════════════════════════════════════════════════════════════════════
# OTP Flow Operations
# ═══════════════════════════════════════════════════════════════════════

GENERATE_OTP_BY_MOBILE = """
mutation GenerateOtpByMobile($input: GenerateOtpRequest_Input!) {
  generateOtpAction(input: $input) {
    otpReferenceId
    otpValue
  }
}
"""

GENERATE_OTP_BY_EMAIL = """
mutation GenerateOtpByEmail($input: GenerateOtpRequest_Input!) {
  generateOtpAction(input: $input) {
    otpReferenceId
    otpValue
  }
}
"""

VALIDATE_OTP = """
mutation ValidateOtp($input: ValidateOtpRequest_Input!) {
  validateOtpAction(input: $input) {
    success
    customer_token
    message
    customer {
      customer_id
      firstname
      lastname
      email
      mobile_number
      login_type
      status
    }
  }
}
"""

# ═══════════════════════════════════════════════════════════════════════
# Customer Operations
# ═══════════════════════════════════════════════════════════════════════

CUSTOMER_REGISTER = """
mutation CustomerRegister($input: CustomerRequest_Input!) {
  customerAction(input: $input) {
    otpReferenceId
    otpValue
    success
    message
    error
  }
}
"""

CUSTOMER_UPDATE = """
mutation CustomerUpdate($input: CustomerRequest_Input!) {
  customerAction(input: $input) {
    success
    message
    error
    customer {
      customer_id
      firstname
      lastname
      email
      mobile_number
      login_type
      status
    }
  }
}
"""

# ═══════════════════════════════════════════════════════════════════════
# Google SSO
# ═══════════════════════════════════════════════════════════════════════

GOOGLE_SSO = """
mutation GoogleSso($input: GoogleSsoRequest_Input!) {
  googleSsoAction(input: $input) {
    success
    customer_token
    message
    customer {
      customer_id
      firstname
      lastname
      email
      login_type
      status
    }
  }
}
"""

# ═══════════════════════════════════════════════════════════════════════
# Commerce Proxy Queries (pass-through via API Mesh)
# ═══════════════════════════════════════════════════════════════════════

COMMERCE_STORE_CONFIG = """
query StoreConfig {
  storeConfig {
    store_name
    base_currency_code
    default_display_currency_code
    locale
    store_code
  }
}
"""

COMMERCE_CMS_PAGE = """
query CmsPage($identifier: String!) {
  cmsPage(identifier: $identifier) {
    title
    content
    url_key
    meta_title
    meta_description
  }
}
"""

COMMERCE_CATEGORIES = """
query Categories {
  categories(filters: { parent_id: { eq: "2" } }) {
    items {
      id
      name
      url_path
      children_count
    }
  }
}
"""

COMMERCE_CUSTOMER_BY_TOKEN = """
query Customer {
  customer {
    firstname
    lastname
    email
  }
}
"""
