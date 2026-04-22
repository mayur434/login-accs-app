import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import {
  ActionButton, Button, Divider, Flex, Heading, Link,
  NumberField, ProgressCircle, StatusLight, Switch, Text,
  TextField, Tooltip, TooltipTrigger, View, Well
} from '@adobe/react-spectrum'
import Info from '@spectrum-icons/workflow/Info'
import Refresh from '@spectrum-icons/workflow/Refresh'
import useConfigApi from './useConfigApi'

/* ── Helpers ──────────────────────────────────────────────── */

function InfoTip ({ label }) {
  return (
    <TooltipTrigger delay={0}>
      <ActionButton isQuiet aria-label={label}><Info size='S' /></ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  )
}

function Section ({ title, children, description }) {
  return (
    <Well marginTop='size-200'>
      <Heading level={3} marginBottom='size-50'>{title}</Heading>
      {description && <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)', fontSize: 13 }}>{description}</Text>}
      <Divider size='S' marginTop='size-100' marginBottom='size-150' />
      {children}
    </Well>
  )
}

/* ── Map helpers ──────────────────────────────────────────── */

const mapLoad = (r) => ({
  isEnabled: Boolean(r.is_enabled),
  autoLogin: Boolean(r.auto_login),
  allowKeyInfoUpdate: Boolean(r.allow_key_info_update),
  otpValidity: Number.isInteger(r.otp_expiration_validity) ? r.otp_expiration_validity : 5,
  // OTP value should be hidden by default unless explicitly enabled for dev.
  otpBypass: typeof r.otp_in_response === 'boolean' ? r.otp_in_response : false,
  smsTemplateEnabled: Boolean(r.sms_template_enabled),
  smsFallbackEnabled: Boolean(r.sms_fallback_enabled),
  emailTemplateEnabled: Boolean(r.email_template_enabled),
  // Google SSO
  googleSsoEnabled: Boolean(r.google_sso_enabled),
  googleClientId: typeof r.google_client_id === 'string' ? r.google_client_id : '',
  googleClientSecretConfigured: Boolean(r.google_client_secret_configured)
})

const mapSave = (s) => {
  const payload = {
    is_enabled: s.isEnabled,
    auto_login: s.autoLogin,
    allow_key_info_update: s.allowKeyInfoUpdate,
    otp_expiration_validity: s.otpValidity,
    otp_in_response: s.otpBypass,
    sms_template_enabled: s.smsTemplateEnabled,
    sms_fallback_enabled: s.smsFallbackEnabled,
    email_template_enabled: s.emailTemplateEnabled,
    // Google SSO
    google_sso_enabled: s.googleSsoEnabled,
    google_client_id: s.googleClientId
  }
  // Only send secret if it was changed (non-empty string entered by user)
  if (s.googleClientSecretInput && s.googleClientSecretInput.trim()) {
    payload.google_client_secret = s.googleClientSecretInput.trim()
  }
  return payload
}

/* ── Component ────────────────────────────────────────────── */

const AdminUi = (props) => {
  const {
    isLoading, isSaving, errorMessage, successMessage,
    savedRef, loadConfig, saveConfig, isAuthBypass
  } = useConfigApi(props.ims, mapLoad, mapSave)

  // ── Form state ──
  const [isEnabled, setIsEnabled] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [otpBypass, setOtpBypass] = useState(false)
  const [otpValidity, setOtpValidity] = useState(5)
  const [allowKeyInfoUpdate, setAllowKeyInfoUpdate] = useState(false)
  const [smsTemplateEnabled, setSmsTemplateEnabled] = useState(false)
  const [smsFallbackEnabled, setSmsFallbackEnabled] = useState(false)
  const [emailTemplateEnabled, setEmailTemplateEnabled] = useState(false)
  // Google SSO
  const [googleSsoEnabled, setGoogleSsoEnabled] = useState(false)
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState('')
  const [googleClientSecretConfigured, setGoogleClientSecretConfigured] = useState(false)

  const formDisabled = isLoading || isSaving

  // ── Dirty detection ──
  const isDirty = (() => {
    if (!savedRef.current) return false
    const s = savedRef.current
    return isEnabled !== s.isEnabled || autoLogin !== s.autoLogin ||
      otpBypass !== s.otpBypass || otpValidity !== s.otpValidity ||
      allowKeyInfoUpdate !== s.allowKeyInfoUpdate ||
      smsTemplateEnabled !== s.smsTemplateEnabled ||
      smsFallbackEnabled !== s.smsFallbackEnabled ||
      emailTemplateEnabled !== s.emailTemplateEnabled ||
      googleSsoEnabled !== s.googleSsoEnabled ||
      googleClientId !== s.googleClientId ||
      googleClientSecretInput !== ''
  })()

  // ── Load on mount ──
  useEffect(() => {
    loadConfig().then(loaded => {
      if (loaded) applyLoaded(loaded)
    })
  }, [props.ims?.token, props.ims?.org])

  function applyLoaded (l) {
    setIsEnabled(l.isEnabled)
    setAutoLogin(l.autoLogin)
    setOtpBypass(l.otpBypass)
    setOtpValidity(l.otpValidity)
    setAllowKeyInfoUpdate(l.allowKeyInfoUpdate)
    setSmsTemplateEnabled(l.smsTemplateEnabled)
    setSmsFallbackEnabled(l.smsFallbackEnabled)
    setEmailTemplateEnabled(l.emailTemplateEnabled)
    // Google SSO
    setGoogleSsoEnabled(l.googleSsoEnabled)
    setGoogleClientId(l.googleClientId)
    setGoogleClientSecretConfigured(l.googleClientSecretConfigured)
    setGoogleClientSecretInput('')
  }

  async function handleSave () {
    const ok = await saveConfig({
      isEnabled,
      autoLogin,
      otpBypass,
      otpValidity,
      allowKeyInfoUpdate,
      smsTemplateEnabled,
      smsFallbackEnabled,
      emailTemplateEnabled,
      googleSsoEnabled,
      googleClientId,
      googleClientSecretInput
    })
    if (ok) {
      if (googleClientSecretInput.trim()) setGoogleClientSecretConfigured(true)
      setGoogleClientSecretInput('')
      savedRef.current = {
        isEnabled,
        autoLogin,
        otpBypass,
        otpValidity,
        allowKeyInfoUpdate,
        smsTemplateEnabled,
        smsFallbackEnabled,
        emailTemplateEnabled,
        googleSsoEnabled,
        googleClientId
      }
    }
  }

  async function handleRefresh () {
    const loaded = await loadConfig()
    if (loaded) applyLoaded(loaded)
  }

  function onToggle (setter) {
    return (selected) => { setter(selected) }
  }

  function onOtpValidityChange (value) {
    setOtpValidity(Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1)
  }

  // ── Render ──
  return (
    <View maxWidth='size-6000'>
      {/* ── Header ── */}
      <Flex alignItems='center' justifyContent='space-between'>
        <Flex alignItems='center' gap='size-100'>
          <Heading level={1} marginBottom='size-0'>Application Setup</Heading>
          {!isLoading && (
            <StatusLight variant={isEnabled ? 'positive' : 'neutral'} marginTop='size-50'>
              {isEnabled ? 'Active' : 'Inactive'}
            </StatusLight>
          )}
        </Flex>
        <TooltipTrigger delay={0}>
          <ActionButton isQuiet onPress={handleRefresh} isDisabled={formDisabled} aria-label='Refresh'>
            <Refresh size='S' />
          </ActionButton>
          <Tooltip>Reload configuration</Tooltip>
        </TooltipTrigger>
      </Flex>

      <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)', fontSize: 13 }}>
        Manage OTP-based customer authentication for Adobe Commerce.
      </Text>

      {/* ── Loading ── */}
      {(isLoading || isSaving) && (
        <Flex alignItems='center' gap='size-100' marginTop='size-200'>
          <ProgressCircle aria-label={isSaving ? 'Saving…' : 'Loading…'} isIndeterminate size='S' />
          <Text>{isSaving ? 'Saving…' : 'Loading…'}</Text>
        </Flex>
      )}

      {errorMessage && <View marginTop='size-150'><StatusLight variant='negative'>{errorMessage}</StatusLight></View>}
      {successMessage && <View marginTop='size-150'><StatusLight variant='positive'>{successMessage}</StatusLight></View>}

      {/* ───── Module ───── */}
      <Section title='Module' description='Master toggle for the login module.'>
        <Switch isSelected={isEnabled} isDisabled={formDisabled} onChange={onToggle(setIsEnabled)}>
          Enable Module
        </Switch>
      </Section>

      {/* ───── Authentication ───── */}
      <Section title='Authentication' description='Control how customers authenticate after OTP verification.'>
        <Flex alignItems='center' gap='size-100'>
          <Switch isSelected={autoLogin} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setAutoLogin)}>
            Auto Login
          </Switch>
          <InfoTip label='Automatically log the customer in after successful OTP verification.' />
        </Flex>
      </Section>

      {/* ───── OTP Settings ───── */}
      <Section title='OTP Settings' description='Configure one-time password behaviour.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={otpBypass} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setOtpBypass)}>
              OTP Bypass (Dev)
            </Switch>
            <InfoTip label='Include the OTP value in the API response for testing. Disable in production.' />
          </Flex>
          <Flex alignItems='center' gap='size-100'>
            <NumberField label='OTP Expiration (minutes)' value={otpValidity} onChange={onOtpValidityChange}
              minValue={1} step={1} width='size-2400' isDisabled={formDisabled || !isEnabled} />
            <InfoTip label='Duration in minutes before an issued OTP expires.' />
          </Flex>
        </Flex>
      </Section>

      {/* ───── Security ───── */}
      <Section title='Security' description='Control what customers are allowed to update.'>
        <Flex alignItems='center' gap='size-100'>
          <Switch isSelected={allowKeyInfoUpdate} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setAllowKeyInfoUpdate)}>
            Allow Key Info Update
          </Switch>
          <InfoTip label='Allows customers to update identity fields such as mobile-to-email mappings.' />
        </Flex>
      </Section>

      <Section title='Communication Flags' description='Quick toggles for SMS and email delivery behavior.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={smsTemplateEnabled} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setSmsTemplateEnabled)}>
              Enable SMS Template
            </Switch>
            <InfoTip label='Controls whether OTP SMS messages are sent at all.' />
          </Flex>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={smsFallbackEnabled} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setSmsFallbackEnabled)}>
              Enable SMS Fallback
            </Switch>
            <InfoTip label='Uses the ICS provider when the primary SMS provider fails.' />
          </Flex>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={emailTemplateEnabled} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setEmailTemplateEnabled)}>
              Enable Email Template
            </Switch>
            <InfoTip label='Controls whether OTP emails are sent when email delivery is used.' />
          </Flex>
        </Flex>
      </Section>

      {/* ───── Google SSO ───── */}
      <Section title='Google SSO' description='Enable single sign-on via Google OAuth 2.0.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={googleSsoEnabled} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setGoogleSsoEnabled)}>
              Enable Google SSO
            </Switch>
            <InfoTip label='Allow customers to sign in or register using their Google account.' />
          </Flex>
          {googleSsoEnabled && (
            <Flex direction='column' gap='size-150' marginStart='size-300'>
              <TextField
                label='Google Client ID'
                value={googleClientId}
                onChange={setGoogleClientId}
                isDisabled={formDisabled}
                width='size-5000'
                description='OAuth 2.0 Client ID from Google Cloud Console.'
              />
              <TextField
                label='Google Client Secret'
                type='password'
                value={googleClientSecretInput}
                onChange={setGoogleClientSecretInput}
                isDisabled={formDisabled}
                width='size-5000'
                placeholder={googleClientSecretConfigured ? '••••••••  (already saved — enter to replace)' : 'Enter client secret'}
                description='Leave blank to keep the existing saved secret.'
              />
              {googleClientSecretConfigured && (
                <Text UNSAFE_style={{ fontSize: 12, color: 'var(--spectrum-global-color-green-600)' }}>
                  ✓ Client secret is saved
                </Text>
              )}
            </Flex>
          )}
        </Flex>
      </Section>

      {/* ── Actions Bar ── */}
      <Flex marginTop='size-300' gap='size-200' alignItems='center'>
        <Button variant='accent' onPress={handleSave} isDisabled={formDisabled || !isDirty}>
          {isSaving ? 'Saving…' : 'Save Configuration'}
        </Button>
        {isDirty && (
          <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-orange-600)', fontSize: 13, fontStyle: 'italic' }}>
            Unsaved changes
          </Text>
        )}
      </Flex>

      {/* ───── Resources ───── */}
      <Divider size='S' marginTop='size-400' marginBottom='size-200' />
      <Heading level={4}>Resources</Heading>
      <Flex direction='column' gap='size-100' marginTop='size-50'>
        <Link>
          <a href='https://documenter.getpostman.com/view/38215772/2sBXijJBVG' target='_blank' rel='noopener noreferrer'>
            App API Documentation
          </a>
        </Link>
        <Link>
          <a href='https://docs.google.com/document/d/1DLiipwI7Ppq0j8xZSSejzOjDizT-Com73chVAElpvF4/edit?tab=t.0' target='_blank' rel='noopener noreferrer'>
            App Document
          </a>
        </Link>
      </Flex>
    </View>
  )
}

AdminUi.propTypes = {
  ims: PropTypes.any
}

export default AdminUi