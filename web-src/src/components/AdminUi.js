import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import {
  ActionButton, AlertDialog, Button, DialogContainer, Divider,
  Flex, Heading, Link, NumberField, ProgressCircle, StatusLight,
  Switch, Text, Tooltip, TooltipTrigger, View, Well
} from '@adobe/react-spectrum'
import allActions from '../config.json'
import actionWebInvoke from '../utils'
import Info from '@spectrum-icons/workflow/Info'
import Refresh from '@spectrum-icons/workflow/Refresh'

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

/* ── Component ────────────────────────────────────────────── */

const AdminUi = (props) => {
  // ── Saved (server) state snapshot ──
  const savedRef = useRef(null)

  // ── Form state ──
  const [isEnabled, setIsEnabled] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [otpBypass, setOtpBypass] = useState(false)
  const [otpValidity, setOtpValidity] = useState(5)
  const [allowKeyInfoUpdate, setAllowKeyInfoUpdate] = useState(false)

  // ── UI state ──
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)
  const [showSaveErrorDialog, setShowSaveErrorDialog] = useState(false)
  const [saveErrorDialogMessage, setSaveErrorDialogMessage] = useState('Unable to update module setting')

  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const formDisabled = isLoading || isSaving

  // ── Dirty detection ──
  const isDirty = (() => {
    if (!savedRef.current) return false
    const s = savedRef.current
    return isEnabled !== s.isEnabled ||
      autoLogin !== s.autoLogin ||
      otpBypass !== s.otpBypass ||
      otpValidity !== s.otpValidity ||
      allowKeyInfoUpdate !== s.allowKeyInfoUpdate
  })()

  // ── Auto-dismiss success after 4s ──
  const successTimer = useRef(null)
  useEffect(() => {
    if (successMessage) {
      clearTimeout(successTimer.current)
      successTimer.current = setTimeout(() => setSuccessMessage(null), 4000)
    }
    return () => clearTimeout(successTimer.current)
  }, [successMessage])

  // ── Load config on mount / token change ──
  useEffect(() => {
    const hasToken = Boolean(props.ims && props.ims.token)
    if (!hasToken && !isLocal) {
      setIsLoading(false)
      setErrorMessage('Waiting for Adobe IMS session...')
      return
    }
    loadConfig()
  }, [props.ims && props.ims.token, props.ims && props.ims.org])

  // ── Render ──
  return (
    <View maxWidth='size-6000'>
      {/* ── Header ── */}
      <Flex alignItems='center' justifyContent='space-between'>
        <Flex alignItems='center' gap='size-100'>
          <Heading level={1} marginBottom='size-0'>Login Module</Heading>
          {!isLoading && (
            <StatusLight variant={isEnabled ? 'positive' : 'neutral'} marginTop='size-50'>
              {isEnabled ? 'Active' : 'Inactive'}
            </StatusLight>
          )}
        </Flex>
        <TooltipTrigger delay={0}>
          <ActionButton isQuiet onPress={loadConfig} isDisabled={formDisabled} aria-label='Refresh configuration'>
            <Refresh size='S' />
          </ActionButton>
          <Tooltip>Reload configuration from server</Tooltip>
        </TooltipTrigger>
      </Flex>

      <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)', fontSize: 13 }}>
        Manage OTP-based customer authentication for Adobe Commerce.
      </Text>

      {/* ── Loading bar ── */}
      {(isLoading || isSaving) && (
        <Flex alignItems='center' gap='size-100' marginTop='size-200'>
          <ProgressCircle aria-label={isSaving ? 'Saving…' : 'Loading…'} isIndeterminate size='S' />
          <Text>{isSaving ? 'Saving configuration…' : 'Loading configuration…'}</Text>
        </Flex>
      )}

      {/* ── Notifications ── */}
      {errorMessage && (
        <View marginTop='size-150'>
          <StatusLight variant='negative'>{errorMessage}</StatusLight>
        </View>
      )}
      {successMessage && (
        <View marginTop='size-150'>
          <StatusLight variant='positive'>{successMessage}</StatusLight>
        </View>
      )}

      {/* ───── Section: Module ───── */}
      <Section title='Module' description='Master toggle for the login module.'>
        <Switch isSelected={isEnabled} isDisabled={formDisabled} onChange={onToggle(setIsEnabled)}>
          Enable Module
        </Switch>
      </Section>

      {/* ───── Section: Authentication ───── */}
      <Section title='Authentication' description='Control how customers authenticate after OTP verification.'>
        <Flex direction='column' gap='size-100'>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={autoLogin} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setAutoLogin)}>
              Auto Login
            </Switch>
            <InfoTip label='Automatically log the customer in after successful OTP verification.' />
          </Flex>
        </Flex>
      </Section>

      {/* ───── Section: OTP ───── */}
      <Section title='OTP Settings' description='Configure one-time password behaviour.'>
        <Flex direction='column' gap='size-150'>
          <Flex alignItems='center' gap='size-100'>
            <Switch isSelected={otpBypass} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setOtpBypass)}>
              OTP Bypass (Dev)
            </Switch>
            <InfoTip label='Include the OTP value in the API response for testing purposes. Disable in production.' />
          </Flex>

          <Flex alignItems='center' gap='size-100'>
            <NumberField
              label='OTP Expiration (minutes)'
              value={otpValidity}
              onChange={onOtpValidityChange}
              minValue={1}
              step={1}
              width='size-2400'
              isDisabled={formDisabled || !isEnabled}
            />
            <InfoTip label='Duration in minutes before an issued OTP expires.' />
          </Flex>
        </Flex>
      </Section>

      {/* ───── Section: Security ───── */}
      <Section title='Security' description='Control what customers are allowed to update.'>
        <Flex alignItems='center' gap='size-100'>
          <Switch isSelected={allowKeyInfoUpdate} isDisabled={formDisabled || !isEnabled} onChange={onToggle(setAllowKeyInfoUpdate)}>
            Allow Key Info Update
          </Switch>
          <InfoTip label='Allows customers to update identity fields such as mobile-to-email mappings.' />
        </Flex>
      </Section>

      {/* ── Actions Bar ── */}
      <Flex marginTop='size-300' gap='size-200' alignItems='center'>
        <Button variant='accent' onPress={saveConfig} isDisabled={formDisabled || !isDirty}>
          {isSaving ? 'Saving…' : 'Save Configuration'}
        </Button>
        {isDirty && (
          <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-orange-600)', fontSize: 13, fontStyle: 'italic' }}>
            Unsaved changes
          </Text>
        )}
      </Flex>

      {/* ── Save Error Dialog ── */}
      <DialogContainer onDismiss={closeSaveErrorDialog}>
        {showSaveErrorDialog && (
          <AlertDialog
            title='Failed to save configuration'
            variant='error'
            primaryActionLabel='Try Again'
            cancelLabel='Close'
            onPrimaryAction={saveConfig}
            onCancel={closeSaveErrorDialog}
          >
            {saveErrorDialogMessage}
          </AlertDialog>
        )}
      </DialogContainer>

      {/* ───── Section: Resources ───── */}
      <Divider size='S' marginTop='size-400' marginBottom='size-200' />
      <Heading level={4}>Resources</Heading>
      <Flex direction='column' gap='size-100' marginTop='size-50'>
        <Link>
          <a href='https://documenter.getpostman.com/view/38215772/2sBXijJBVG' target='_blank' rel='noopener noreferrer'>
            API Documentation (Postman)
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

  /* ── Handlers ─────────────────────────────────────────── */

  function onToggle (setter) {
    return function (selected) {
      setter(selected)
      setErrorMessage(null)
      setSuccessMessage(null)
    }
  }

  function onOtpValidityChange (value) {
    const nextValue = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
    setOtpValidity(nextValue)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  async function loadConfig () {
    setIsLoading(true)
    setErrorMessage(null)
    const authHeaders = getAuthHeaders()
    if (!authHeaders.authorization && !isLocal) {
      setErrorMessage('Missing Adobe IMS session. Open this extension from Adobe Commerce Admin and wait for context load.')
      setIsLoading(false)
      return
    }
    const actionUrl = allActions['login-module/config']
    if (!actionUrl) {
      setErrorMessage('config action URL is missing in config.json')
      setIsLoading(false)
      return
    }
    try {
      const response = await actionWebInvoke(actionUrl, authHeaders, {}, { method: 'GET' })
      const loaded = {
        isEnabled: Boolean(response.is_enabled),
        autoLogin: Boolean(response.auto_login),
        allowKeyInfoUpdate: Boolean(response.allow_key_info_update),
        otpValidity: Number.isInteger(response.otp_expiration_validity) ? response.otp_expiration_validity : 5,
        otpBypass: typeof response.otp_in_response === 'boolean' ? response.otp_in_response : true
      }
      setIsEnabled(loaded.isEnabled)
      setAutoLogin(loaded.autoLogin)
      setAllowKeyInfoUpdate(loaded.allowKeyInfoUpdate)
      setOtpValidity(loaded.otpValidity)
      setOtpBypass(loaded.otpBypass)
      savedRef.current = loaded
      setSuccessMessage(null)
    } catch (e) {
      setErrorMessage(getActionErrorMessage(e, 'load'))
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  async function saveConfig () {
    setIsSaving(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    let saveFailed = false
    let saveErrorText = ''
    const authHeaders = getAuthHeaders()

    if (!authHeaders.authorization && !isLocal) {
      setErrorMessage('Missing Adobe IMS session. Open this extension from Adobe Commerce Admin and wait for context load.')
      setIsSaving(false)
      return
    }

    const actionUrl = allActions['login-module/config']
    if (!actionUrl) {
      setErrorMessage('config action URL is missing in config.json')
      setIsSaving(false)
      return
    }

    try {
      const response = await actionWebInvoke(
        actionUrl,
        authHeaders,
        {
          is_enabled: isEnabled,
          auto_login: autoLogin,
          allow_key_info_update: allowKeyInfoUpdate,
          otp_expiration_validity: otpValidity,
          otp_in_response: otpBypass
        },
        { method: 'POST' }
      )
      const saved = {
        isEnabled: Boolean(response.is_enabled),
        autoLogin: Boolean(response.auto_login),
        allowKeyInfoUpdate: Boolean(response.allow_key_info_update),
        otpValidity: Number.isInteger(response.otp_expiration_validity) ? response.otp_expiration_validity : otpValidity,
        otpBypass: typeof response.otp_in_response === 'boolean' ? response.otp_in_response : otpBypass
      }
      setIsEnabled(saved.isEnabled)
      setAutoLogin(saved.autoLogin)
      setAllowKeyInfoUpdate(saved.allowKeyInfoUpdate)
      setOtpValidity(saved.otpValidity)
      setOtpBypass(saved.otpBypass)
      savedRef.current = saved
    } catch (e) {
      saveFailed = true
      saveErrorText = getActionErrorMessage(e, 'save')
      setErrorMessage(saveErrorText)
      setSaveErrorDialogMessage(saveErrorText)
      setShowSaveErrorDialog(true)
      console.error(e)
    } finally {
      setIsSaving(false)
      if (!saveFailed) {
        setSuccessMessage('Configuration saved successfully')
      }
    }
  }

  function closeSaveErrorDialog () {
    setShowSaveErrorDialog(false)
  }

  function getActionErrorMessage (error, operation) {
    const message = (error && error.message) ? error.message : ''
    if (message.includes('status: 404')) {
      return 'config action is not available (404). Restart aio app dev/run or deploy the updated app.'
    }
    return operation === 'load' ? 'Unable to load app config' : 'Unable to update module setting'
  }

  function getAuthHeaders () {
    const headers = {}
    if (props.ims && props.ims.token) {
      headers.authorization = `Bearer ${props.ims.token}`
    }
    if (props.ims && props.ims.org) {
      headers['x-gw-ims-org-id'] = props.ims.org
    }
    return headers
  }
}

AdminUi.propTypes = {
  ims: PropTypes.any
}

export default AdminUi