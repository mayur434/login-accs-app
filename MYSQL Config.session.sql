-- Turn OFF OTP bypass — SMS will be dispatched instead of returning OTP in response
-- UPDATE app_config 
-- SET otp_in_response = 0 
-- WHERE _id = 'app_config';

-- DELETE FROM customer_mobile_identity
-- WHERE email = 'aditi.new@gmail.com';

-- -- Verify the change
-- SELECT _id, otp_in_response, sms_template_enabled, auto_register FROM app_config WHERE _id = 'app_config';

-- Enable Google SSO
-- UPDATE app_config
-- SET google_sso_enabled = 1
-- WHERE _id = 'app_config';

-- Disable Google SSO
-- UPDATE app_config
-- SET google_sso_enabled = 0
-- WHERE _id = 'app_config';

-- Verify Google SSO config
-- SELECT _id, google_sso_enabled, google_client_id
-- FROM app_config
-- WHERE _id = 'app_config';

-- SELECT _id, google_sso_enabled, google_client_id, google_client_secret
-- FROM app_config
-- WHERE _id = 'app_config';

-- UPDATE app_config SET
--   email_smtp_host     = 'email-smtp.ap-south-1.amazonaws.com',
--   email_smtp_port     = 587,
--   email_smtp_user     = 'AKIAQE3RO7TIMNCGSNT2',
--   email_smtp_password = 'BFj+tixPISfV0rfLEqni6Nv6VBA9/DARbfWQsAcxjZmH',
--   email_from_address  = 'noreply@vijaysales.com',
--   email_template_enabled = 1
-- WHERE _id = 'app_config';

UPDATE app_config SET
  sms_api_host          = 'https://api.kaleyra.io',
  sms_endpoint          = '/v1/HXAP1683857602IN/messages',
  sms_api_key           = 'A781381814704eedf976f2f676ebaf0c2',
  sms_sender_id         = 'VIJAYS',
  sms_type              = 'OTP',
  sms_template_enabled  = 1,
  sms_template_string   = 'Dear Guest, Welcome to Vijay Sales! Please use OTP {{OTP}} to proceed',
  sms_fallback_enabled  = 1,
  sms_ics_api_host      = 'https://sms.sendmsg.in',
  sms_ics_endpoint      = '/smpp',
  sms_ics_username      = 'vijaysales_tr',
  sms_ics_password      = 'kHpPfNeiqwbq',
  sms_ics_sender        = 'VIJAYS',
  sms_ics_urlshortening = '1'
WHERE _id = 'app_config';