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
  smsTemplateEnabled: Boolean(r.sms_template_enabled),
  smsTemplateId: r.sms_template_id || '',
  smsTemplateString: r.sms_template_string || 'Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.'
})

const mapSave = (s) => ({
  sms_api_host: s.smsApiHost,
  sms_endpoint: s.smsEndpoint,
  sms_api_key: s.smsApiKey,
  sms_template_enabled: s.smsTemplateEnabled,
  sms_template_id: s.smsTemplateId,
  sms_template_string: s.smsTemplateString
})

export default function SmsConfigUi ({ ims }) {
  const {
    isLoading, isSaving, errorMessage, successMessage,
    savedRef, loadConfig, saveConfig, isLocal
  } = useConfigApi(ims, mapLoad, mapSave)

  const [smsApiHost, setSmsApiHost] = useState('')
  const [smsEndpoint, setSmsEndpoint] = useState('')
  const [smsApiKey, setSmsApiKey] = useState('')
  const [smsTemplateEnabled, setSmsTemplateEnabled] = useState(false)
  const [smsTemplateId, setSmsTemplateId] = useState('')
  const [smsTemplateString, setSmsTemplateString] = useState('Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.')

  const [validationError, setValidationError] = useState(null)

  const formDisabled = isLoading || isSaving

  // Primary settings complete when all gateway fields are filled
  const gatewayComplete = smsApiHost.trim() !== '' && smsEndpoint.trim() !== '' && smsApiKey.trim() !== ''
  // Template fields valid when disabled, or when both ID and string are filled
  const templateValid = !smsTemplateEnabled || (smsTemplateId.trim() !== '' && smsTemplateString.trim() !== '')

  const isDirty = (() => {
    if (!savedRef.current) return false
    const s = savedRef.current
    return smsApiHost !== s.smsApiHost || smsEndpoint !== s.smsEndpoint ||
      smsApiKey !== s.smsApiKey || smsTemplateEnabled !== s.smsTemplateEnabled ||
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
    setSmsTemplateEnabled(l.smsTemplateEnabled)
    setSmsTemplateId(l.smsTemplateId)
    setSmsTemplateString(l.smsTemplateString)
  }

  async function handleSave () {
    setValidationError(null)
    if (smsTemplateEnabled && !gatewayComplete) {
      setValidationError('Fill all API Gateway fields (Host, Endpoint, API Key) before enabling the template.')
      return
    }
    if (smsTemplateEnabled && !templateValid) {
      setValidationError('Template ID and Template String are required when SMS template is enabled.')
      return
    }
    const ok = await saveConfig({
      smsApiHost, smsEndpoint, smsApiKey,
      smsTemplateEnabled, smsTemplateId, smsTemplateString
    })
    if (ok) {
      savedRef.current = {
        smsApiHost, smsEndpoint, smsApiKey,
        smsTemplateEnabled, smsTemplateId, smsTemplateString
      }
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
            <StatusLight variant={smsTemplateEnabled ? 'positive' : 'neutral'}>
              {smsTemplateEnabled ? 'Enabled' : 'Disabled'}
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
        Configure SMS gateway settings for OTP delivery via SMS.
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
              validationState={smsTemplateEnabled && !smsApiKey.trim() ? 'invalid' : undefined}
              type='password'
              placeholder='sk-xxxxxxxxxxxxxxxx' />
            <InfoTip label='Authentication key for the SMS API.' />
          </Flex>
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
              isRequired={smsTemplateEnabled}
              validationState={smsTemplateEnabled && !smsTemplateId.trim() ? 'invalid' : undefined}
              placeholder='tpl_otp_login_001' />
            <InfoTip label='Unique template identifier from your SMS provider.' />
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
