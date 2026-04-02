import React, { useEffect, useState } from 'react'
import {
  ActionButton, Button, Divider, Flex, Heading,
  ProgressCircle, StatusLight, Switch, Text, TextArea,
  TextField, Tooltip, TooltipTrigger, View, Well
} from '@adobe/react-spectrum'
import Info from '@spectrum-icons/workflow/Info'
import Refresh from '@spectrum-icons/workflow/Refresh'
import useConfigApi from './useConfigApi'

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

const mapLoad = (r) => ({
  smsApiHost: r.sms_api_host || '',
  smsEndpoint: r.sms_endpoint || '',
  smsApiKey: r.sms_api_key || '',
  smsApiKeyConfigured: Boolean(r.sms_api_key_configured),
  smsSenderId: r.sms_sender_id || '',
  smsType: r.sms_type || 'OTP',
  smsFallbackEnabled: Boolean(r.sms_fallback_enabled),
  smsIcsApiHost: r.sms_ics_api_host || 'https://sms.sendmsg.in',
  smsIcsEndpoint: r.sms_ics_endpoint || '/smpp',
  smsIcsUsername: r.sms_ics_username || '',
  smsIcsPassword: r.sms_ics_password || '',
  smsIcsPasswordConfigured: Boolean(r.sms_ics_password_configured),
  smsIcsSender: r.sms_ics_sender || '',
  smsIcsUrlshortening: r.sms_ics_urlshortening || '1',
  smsTemplateEnabled: Boolean(r.sms_template_enabled),
  smsTemplateId: r.sms_template_id || '',
  smsTemplateString: r.sms_template_string || 'Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.'
})

const mapSave = (s) => {
  const payload = {
    sms_api_host: s.smsApiHost,
    sms_endpoint: s.smsEndpoint,
    sms_sender_id: s.smsSenderId,
    sms_type: s.smsType,
    sms_fallback_enabled: s.smsFallbackEnabled,
    sms_ics_api_host: s.smsIcsApiHost,
    sms_ics_endpoint: s.smsIcsEndpoint,
    sms_ics_username: s.smsIcsUsername,
    sms_ics_sender: s.smsIcsSender,
    sms_ics_urlshortening: s.smsIcsUrlshortening,
    sms_template_enabled: s.smsTemplateEnabled,
    sms_template_id: s.smsTemplateId,
    sms_template_string: s.smsTemplateString
  }
  if (s.smsApiKey && s.smsApiKey.trim() !== '') payload.sms_api_key = s.smsApiKey
  if (s.smsIcsPassword && s.smsIcsPassword.trim() !== '') payload.sms_ics_password = s.smsIcsPassword
  return payload
}

export default function SmsConfigUi ({ ims }) {
  const {
    isLoading, isSaving, errorMessage, successMessage,
    savedRef, loadConfig, saveConfig, isAuthBypass
  } = useConfigApi(ims, mapLoad, mapSave)

  const [smsApiHost, setSmsApiHost] = useState('')
  const [smsEndpoint, setSmsEndpoint] = useState('')
  const [smsApiKey, setSmsApiKey] = useState('')
  const [smsApiKeyConfigured, setSmsApiKeyConfigured] = useState(false)
  const [smsSenderId, setSmsSenderId] = useState('')
  const [smsType, setSmsType] = useState('OTP')
  const [smsFallbackEnabled, setSmsFallbackEnabled] = useState(false)
  const [smsIcsApiHost, setSmsIcsApiHost] = useState('https://sms.sendmsg.in')
  const [smsIcsEndpoint, setSmsIcsEndpoint] = useState('/smpp')
  const [smsIcsUsername, setSmsIcsUsername] = useState('')
  const [smsIcsPassword, setSmsIcsPassword] = useState('')
  const [smsIcsPasswordConfigured, setSmsIcsPasswordConfigured] = useState(false)
  const [smsIcsSender, setSmsIcsSender] = useState('')
  const [smsIcsUrlshortening, setSmsIcsUrlshortening] = useState('1')
  const [smsTemplateEnabled, setSmsTemplateEnabled] = useState(false)
  const [smsTemplateId, setSmsTemplateId] = useState('')
  const [smsTemplateString, setSmsTemplateString] = useState('Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.')

  const [validationError, setValidationError] = useState(null)

  const formDisabled = isLoading || isSaving

  // Primary settings complete when all gateway fields are filled
  const gatewayComplete =
    smsApiHost.trim() !== '' &&
    smsEndpoint.trim() !== '' &&
    smsSenderId.trim() !== '' &&
    (smsApiKey.trim() !== '' || smsApiKeyConfigured)
  const fallbackComplete = !smsFallbackEnabled || (
    smsIcsApiHost.trim() !== '' &&
    smsIcsEndpoint.trim() !== '' &&
    smsIcsUsername.trim() !== '' &&
    smsIcsSender.trim() !== '' &&
    (smsIcsPassword.trim() !== '' || smsIcsPasswordConfigured)
  )
  // Template ID is optional metadata; only the template string is required for runtime sending.
  const templateValid = !smsTemplateEnabled || smsTemplateString.trim() !== ''
  const smsConfigured = gatewayComplete && fallbackComplete

  const isDirty = (() => {
    if (!savedRef.current) return false
    const s = savedRef.current
    return smsApiHost !== s.smsApiHost || smsEndpoint !== s.smsEndpoint ||
      smsApiKey !== s.smsApiKey || smsSenderId !== s.smsSenderId ||
      smsType !== s.smsType || smsFallbackEnabled !== s.smsFallbackEnabled ||
      smsIcsApiHost !== s.smsIcsApiHost || smsIcsEndpoint !== s.smsIcsEndpoint ||
      smsIcsUsername !== s.smsIcsUsername || smsIcsPassword !== s.smsIcsPassword ||
      smsIcsSender !== s.smsIcsSender || smsIcsUrlshortening !== s.smsIcsUrlshortening ||
      smsTemplateEnabled !== s.smsTemplateEnabled ||
      smsTemplateId !== s.smsTemplateId || smsTemplateString !== s.smsTemplateString
  })()

  useEffect(() => {
    loadConfig().then(loaded => {
      if (loaded) applyLoaded(loaded)
    })
  }, [ims?.token, ims?.org])

  function applyLoaded (l) {
    setSmsApiHost(l.smsApiHost)
    setSmsEndpoint(l.smsEndpoint)
    setSmsApiKey(l.smsApiKey)
    setSmsApiKeyConfigured(l.smsApiKeyConfigured)
    setSmsSenderId(l.smsSenderId)
    setSmsType(l.smsType)
    setSmsFallbackEnabled(l.smsFallbackEnabled)
    setSmsIcsApiHost(l.smsIcsApiHost)
    setSmsIcsEndpoint(l.smsIcsEndpoint)
    setSmsIcsUsername(l.smsIcsUsername)
    setSmsIcsPassword(l.smsIcsPassword)
    setSmsIcsPasswordConfigured(l.smsIcsPasswordConfigured)
    setSmsIcsSender(l.smsIcsSender)
    setSmsIcsUrlshortening(l.smsIcsUrlshortening)
    setSmsTemplateEnabled(l.smsTemplateEnabled)
    setSmsTemplateId(l.smsTemplateId)
    setSmsTemplateString(l.smsTemplateString)
  }

  async function handleSave () {
    setValidationError(null)
    if (smsTemplateEnabled && !gatewayComplete) {
      setValidationError('Fill all API Gateway fields (Host, Endpoint, API Key, Sender ID) before enabling SMS delivery.')
      return
    }
    if (smsTemplateEnabled && !templateValid) {
      setValidationError('Template String is required when SMS template is enabled.')
      return
    }
    if (smsTemplateEnabled && !fallbackComplete) {
      setValidationError('Fill all ICS fallback fields when fallback is enabled.')
      return
    }
    const ok = await saveConfig({
      smsApiHost, smsEndpoint, smsApiKey,
      smsSenderId, smsType, smsFallbackEnabled,
      smsIcsApiHost, smsIcsEndpoint, smsIcsUsername, smsIcsPassword, smsIcsSender, smsIcsUrlshortening,
      smsTemplateEnabled, smsTemplateId, smsTemplateString
    })
    if (ok) {
      savedRef.current = {
        smsApiHost, smsEndpoint, smsApiKey,
        smsSenderId, smsType, smsFallbackEnabled,
        smsIcsApiHost, smsIcsEndpoint, smsIcsUsername, smsIcsPassword, smsIcsSender, smsIcsUrlshortening,
        smsTemplateEnabled, smsTemplateId, smsTemplateString
      }
      if (smsApiKey.trim() !== '') setSmsApiKeyConfigured(true)
      if (smsIcsPassword.trim() !== '') setSmsIcsPasswordConfigured(true)
    }
  }

  async function handleRefresh () {
    const loaded = await loadConfig()
    if (loaded) applyLoaded(loaded)
  }

  return (
    <View maxWidth='size-6000'>
      <Flex alignItems='center' justifyContent='space-between'>
        <Flex alignItems='center' gap='size-100'>
          <Heading level={1} marginBottom='size-0'>SMS Communication</Heading>
          {!isLoading && (
            <>
              <StatusLight variant={smsConfigured ? 'positive' : 'neutral'}>
                {smsConfigured ? 'Configured' : 'Not Configured'}
              </StatusLight>
            </>
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
        Configure SMS gateway settings for OTP delivery via SMS. Saving gateway credentials and enabling SMS delivery are separate steps.
      </Text>

      {(isLoading || isSaving) && (
        <Flex alignItems='center' gap='size-100' marginTop='size-200'>
          <ProgressCircle aria-label={isSaving ? 'Saving…' : 'Loading…'} isIndeterminate size='S' />
          <Text>{isSaving ? 'Saving…' : 'Loading…'}</Text>
        </Flex>
      )}

      {errorMessage && <View marginTop='size-150'><StatusLight variant='negative'>{errorMessage}</StatusLight></View>}
      {validationError && <View marginTop='size-150'><StatusLight variant='negative'>{validationError}</StatusLight></View>}
      {successMessage && <View marginTop='size-150'><StatusLight variant='positive'>{successMessage}</StatusLight></View>}

      {/* ── API Settings ── */}
      <Section title='API Gateway' description='SMS provider connection details.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='API Host' value={smsApiHost} onChange={setSmsApiHost}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={smsTemplateEnabled && !smsApiHost.trim() ? 'invalid' : undefined}
              placeholder='https://api.sms-provider.com' />
            <InfoTip label='Base URL of your SMS gateway API.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='Endpoint' value={smsEndpoint} onChange={setSmsEndpoint}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={smsTemplateEnabled && !smsEndpoint.trim() ? 'invalid' : undefined}
              placeholder='/v1/sms/send' />
            <InfoTip label='API endpoint path appended to the host.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='API Key' value={smsApiKey} onChange={setSmsApiKey}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={smsTemplateEnabled && !(smsApiKey.trim() || smsApiKeyConfigured) ? 'invalid' : undefined}
              type='password'
              placeholder={smsApiKeyConfigured ? 'Stored (enter to rotate)' : 'sk-xxxxxxxxxxxxxxxx'} />
            <InfoTip label='Authentication key for the SMS API.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='Sender ID' value={smsSenderId} onChange={setSmsSenderId}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={smsTemplateEnabled && !smsSenderId.trim() ? 'invalid' : undefined}
              placeholder='VIJAYS' />
            <InfoTip label='Sender ID approved with SMS provider.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='SMS Type' value={smsType} onChange={setSmsType}
              width='size-1600' isDisabled={formDisabled}
              placeholder='OTP' />
            <InfoTip label='Provider message type, default OTP.' />
          </Flex>
        </Flex>
      </Section>

      <Section title='Fallback Provider (ICS)' description='Optional fallback when Kaleyra fails.'>
        <Flex direction='column' gap='size-150'>
          <Switch isSelected={smsFallbackEnabled} onChange={setSmsFallbackEnabled} isDisabled={formDisabled}>
            Enable ICS Fallback
          </Switch>
          <TextField label='ICS API Host' value={smsIcsApiHost} onChange={setSmsIcsApiHost}
            width='size-4600' isDisabled={formDisabled || !smsFallbackEnabled}
            validationState={smsFallbackEnabled && !smsIcsApiHost.trim() ? 'invalid' : undefined}
            placeholder='https://sms.sendmsg.in' />
          <TextField label='ICS Endpoint' value={smsIcsEndpoint} onChange={setSmsIcsEndpoint}
            width='size-4600' isDisabled={formDisabled || !smsFallbackEnabled}
            validationState={smsFallbackEnabled && !smsIcsEndpoint.trim() ? 'invalid' : undefined}
            placeholder='/smpp' />
          <TextField label='ICS Username' value={smsIcsUsername} onChange={setSmsIcsUsername}
            width='size-4600' isDisabled={formDisabled || !smsFallbackEnabled}
            validationState={smsFallbackEnabled && !smsIcsUsername.trim() ? 'invalid' : undefined}
            placeholder='username' />
          <TextField label='ICS Password' value={smsIcsPassword} onChange={setSmsIcsPassword}
            width='size-4600' isDisabled={formDisabled || !smsFallbackEnabled}
            type='password'
            validationState={smsFallbackEnabled && !(smsIcsPassword.trim() || smsIcsPasswordConfigured) ? 'invalid' : undefined}
            placeholder={smsIcsPasswordConfigured ? 'Stored (enter to rotate)' : 'password'} />
          <TextField label='ICS Sender' value={smsIcsSender} onChange={setSmsIcsSender}
            width='size-4600' isDisabled={formDisabled || !smsFallbackEnabled}
            validationState={smsFallbackEnabled && !smsIcsSender.trim() ? 'invalid' : undefined}
            placeholder='VIJAYS' />
          <TextField label='ICS Urlshortening' value={smsIcsUrlshortening} onChange={setSmsIcsUrlshortening}
            width='size-1600' isDisabled={formDisabled || !smsFallbackEnabled}
            placeholder='1' />
        </Flex>
      </Section>

      {/* ── Template ── */}
      <Section title='SMS Template' description='Message template sent to the customer.'>
        <Flex direction='column' gap='size-150'>
          <Switch isSelected={smsTemplateEnabled} onChange={setSmsTemplateEnabled} isDisabled={formDisabled}>
            Enable SMS Template
          </Switch>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='Template ID' value={smsTemplateId} onChange={setSmsTemplateId}
              width='size-4600' isDisabled={formDisabled || !smsTemplateEnabled}
              placeholder='tpl_otp_login_001' />
            <InfoTip label='Optional provider or internal reference. Runtime sending currently uses the template string below.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextArea label='Template String' value={smsTemplateString} onChange={setSmsTemplateString}
              width='size-4600' isDisabled={formDisabled || !smsTemplateEnabled}
              isRequired={smsTemplateEnabled}
              validationState={smsTemplateEnabled && !smsTemplateString.trim() ? 'invalid' : undefined}
              height='size-1000'
              placeholder='Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.' />
            <InfoTip label='Use {{OTP}} for the OTP value and {{VALIDITY}} for validity period in minutes.' />
          </Flex>
        </Flex>
      </Section>

      {/* ── Actions ── */}
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
    </View>
  )
}
