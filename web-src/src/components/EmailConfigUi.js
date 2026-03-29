import React, { useEffect, useState } from 'react'
import {
  ActionButton, Button, Divider, Flex, Heading, NumberField,
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
  emailSmtpHost: r.email_smtp_host || '',
  emailSmtpPort: Number.isInteger(r.email_smtp_port) ? r.email_smtp_port : 587,
  emailSmtpUser: r.email_smtp_user || '',
  emailSmtpPassword: r.email_smtp_password || '',
  emailFromAddress: r.email_from_address || '',
  emailFromName: r.email_from_name || '',
  emailTemplateEnabled: Boolean(r.email_template_enabled),
  emailTemplateId: r.email_template_id || '',
  emailTemplateString: r.email_template_string || 'Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.'
})

const mapSave = (s) => ({
  email_smtp_host: s.emailSmtpHost,
  email_smtp_port: s.emailSmtpPort,
  email_smtp_user: s.emailSmtpUser,
  email_smtp_password: s.emailSmtpPassword,
  email_from_address: s.emailFromAddress,
  email_from_name: s.emailFromName,
  email_template_enabled: s.emailTemplateEnabled,
  email_template_id: s.emailTemplateId,
  email_template_string: s.emailTemplateString
})

export default function EmailConfigUi ({ ims }) {
  const {
    isLoading, isSaving, errorMessage, successMessage,
    savedRef, loadConfig, saveConfig, isLocal
  } = useConfigApi(ims, mapLoad, mapSave)

  const [emailSmtpHost, setEmailSmtpHost] = useState('')
  const [emailSmtpPort, setEmailSmtpPort] = useState(587)
  const [emailSmtpUser, setEmailSmtpUser] = useState('')
  const [emailSmtpPassword, setEmailSmtpPassword] = useState('')
  const [emailFromAddress, setEmailFromAddress] = useState('')
  const [emailFromName, setEmailFromName] = useState('')
  const [emailTemplateEnabled, setEmailTemplateEnabled] = useState(false)
  const [emailTemplateId, setEmailTemplateId] = useState('')
  const [emailTemplateString, setEmailTemplateString] = useState('Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.')

  const [validationError, setValidationError] = useState(null)

  const formDisabled = isLoading || isSaving

  // Primary settings complete when SMTP + sender identity are filled
  const smtpComplete = emailSmtpHost.trim() !== '' && emailSmtpUser.trim() !== '' &&
    emailSmtpPassword.trim() !== '' && emailFromAddress.trim() !== ''
  // Template fields valid when disabled, or when both ID and string are filled
  const templateValid = !emailTemplateEnabled || (emailTemplateId.trim() !== '' && emailTemplateString.trim() !== '')

  const isDirty = (() => {
    if (!savedRef.current) return false
    const s = savedRef.current
    return emailSmtpHost !== s.emailSmtpHost || emailSmtpPort !== s.emailSmtpPort ||
      emailSmtpUser !== s.emailSmtpUser || emailSmtpPassword !== s.emailSmtpPassword ||
      emailFromAddress !== s.emailFromAddress || emailFromName !== s.emailFromName ||
      emailTemplateEnabled !== s.emailTemplateEnabled || emailTemplateId !== s.emailTemplateId ||
      emailTemplateString !== s.emailTemplateString
  })()

  useEffect(() => {
    loadConfig().then(loaded => {
      if (loaded) applyLoaded(loaded)
    })
  }, [ims?.token, ims?.org])

  function applyLoaded (l) {
    setEmailSmtpHost(l.emailSmtpHost)
    setEmailSmtpPort(l.emailSmtpPort)
    setEmailSmtpUser(l.emailSmtpUser)
    setEmailSmtpPassword(l.emailSmtpPassword)
    setEmailFromAddress(l.emailFromAddress)
    setEmailFromName(l.emailFromName)
    setEmailTemplateEnabled(l.emailTemplateEnabled)
    setEmailTemplateId(l.emailTemplateId)
    setEmailTemplateString(l.emailTemplateString)
  }

  async function handleSave () {
    setValidationError(null)
    if (emailTemplateEnabled && !smtpComplete) {
      setValidationError('Fill all required SMTP and Sender fields (Host, Username, Password, From Address) before enabling the template.')
      return
    }
    if (emailTemplateEnabled && !templateValid) {
      setValidationError('Template ID and Template String are required when Email template is enabled.')
      return
    }
    const ok = await saveConfig({
      emailSmtpHost, emailSmtpPort, emailSmtpUser, emailSmtpPassword,
      emailFromAddress, emailFromName, emailTemplateEnabled, emailTemplateId, emailTemplateString
    })
    if (ok) {
      savedRef.current = {
        emailSmtpHost, emailSmtpPort, emailSmtpUser, emailSmtpPassword,
        emailFromAddress, emailFromName, emailTemplateEnabled, emailTemplateId, emailTemplateString
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
          <Heading level={1} marginBottom='size-0'>Email Communication</Heading>
          {!isLoading && (
            <StatusLight variant={emailTemplateEnabled ? 'positive' : 'neutral'}>
              {emailTemplateEnabled ? 'Enabled' : 'Disabled'}
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
        Configure SMTP and template settings for OTP delivery via email.
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

      {/* ── SMTP Settings ── */}
      <Section title='SMTP Server' description='Outbound mail server connection details.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='SMTP Host' value={emailSmtpHost} onChange={setEmailSmtpHost}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={emailTemplateEnabled && !emailSmtpHost.trim() ? 'invalid' : undefined}
              placeholder='smtp.mailprovider.com' />
            <InfoTip label='Hostname or IP of the SMTP server.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <NumberField label='SMTP Port' value={emailSmtpPort} onChange={setEmailSmtpPort}
              width='size-1600' isDisabled={formDisabled} minValue={1} maxValue={65535} />
            <InfoTip label='Common ports: 25 (unencrypted), 465 (SSL), 587 (STARTTLS).' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='SMTP Username' value={emailSmtpUser} onChange={setEmailSmtpUser}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={emailTemplateEnabled && !emailSmtpUser.trim() ? 'invalid' : undefined}
              placeholder='noreply@yourdomain.com' />
            <InfoTip label='SMTP authentication username.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='SMTP Password' value={emailSmtpPassword} onChange={setEmailSmtpPassword}
              width='size-4600' isDisabled={formDisabled} type='password' isRequired
              validationState={emailTemplateEnabled && !emailSmtpPassword.trim() ? 'invalid' : undefined}
              placeholder='••••••••' />
            <InfoTip label='SMTP authentication password or app-specific password.' />
          </Flex>
        </Flex>
      </Section>

      {/* ── Sender Identity ── */}
      <Section title='Sender Identity' description='From address shown to recipients.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='From Address' value={emailFromAddress} onChange={setEmailFromAddress}
              width='size-4600' isDisabled={formDisabled} isRequired
              validationState={emailTemplateEnabled && !emailFromAddress.trim() ? 'invalid' : undefined}
              placeholder='noreply@yourdomain.com' />
            <InfoTip label='The email address that appears in the From field.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='From Name' value={emailFromName} onChange={setEmailFromName}
              width='size-4600' isDisabled={formDisabled}
              placeholder='My Store' />
            <InfoTip label='Display name shown alongside the from address.' />
          </Flex>
        </Flex>
      </Section>

      {/* ── Template ── */}
      <Section title='Email Template' description='Email body template sent to the customer.'>
        <Flex direction='column' gap='size-150'>
          <Switch isSelected={emailTemplateEnabled} onChange={setEmailTemplateEnabled} isDisabled={formDisabled}>
            Enable Email Template
          </Switch>
          <Flex alignItems='end' gap='size-100'>
            <TextField label='Template ID' value={emailTemplateId} onChange={setEmailTemplateId}
              width='size-4600' isDisabled={formDisabled || !emailTemplateEnabled}
              isRequired={emailTemplateEnabled}
              validationState={emailTemplateEnabled && !emailTemplateId.trim() ? 'invalid' : undefined}
              placeholder='tpl_email_otp_001' />
            <InfoTip label='Unique template identifier from your email provider.' />
          </Flex>
          <Flex alignItems='end' gap='size-100'>
            <TextArea label='Template String' value={emailTemplateString} onChange={setEmailTemplateString}
              width='size-4600' isDisabled={formDisabled || !emailTemplateEnabled}
              isRequired={emailTemplateEnabled}
              validationState={emailTemplateEnabled && !emailTemplateString.trim() ? 'invalid' : undefined}
              height='size-1000'
              placeholder='Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.' />
            <InfoTip label='Use {{OTP}} for the OTP value and {{VALIDITY}} for validity in minutes.' />
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
