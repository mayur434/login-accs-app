-- Turn OFF OTP bypass — SMS will be dispatched instead of returning OTP in response
-- UPDATE app_config 
-- SET otp_in_response = 0 
-- WHERE _id = 'app_config';

DELETE FROM customer_mobile_identity
WHERE email = 'aditi.new@gmail.com';

-- -- Verify the change
-- SELECT _id, otp_in_response, sms_template_enabled, auto_register FROM app_config WHERE _id = 'app_config';
