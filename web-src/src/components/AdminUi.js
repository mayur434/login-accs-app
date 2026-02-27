import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { ActionButton, AlertDialog, Button, Checkbox, DialogContainer, Flex, Heading, NumberField, ProgressCircle, StatusLight, Tooltip, TooltipTrigger, View } from '@adobe/react-spectrum'
import allActions from '../config.json'
import actionWebInvoke from '../utils'
import Info from '@spectrum-icons/workflow/Info'

const AdminUi = (props) => {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)
  const [autoLogin, setAutoLogin] = useState(false)
  const [otpValidity, setOtpValidity] = useState(5)
  const [otpBypass, setOtpBypass] = useState(false)
  const [showSaveErrorDialog, setShowSaveErrorDialog] = useState(false)
  const [saveErrorDialogMessage, setSaveErrorDialogMessage] = useState('Unable to update module setting')


  useEffect(() => {
    loadConfig()
  }, [])

  return (
    <View width="size-6000">
      <Heading level={1}>Custom Module Admin Dashboard</Heading>
      <Flex alignItems='center' gap='size-200'>
        <Heading level={3}>Enable Module</Heading>
        <Checkbox size='XL' isSelected={isEnabled} isDisabled={isLoading || isSaving} onChange={onToggleModule} />
      </Flex>

      <Flex alignItems='center' gap='size-200'>
        <Heading level={4}>Auto Login</Heading>
        <Checkbox size='XL' isSelected={autoLogin} isDisabled={isLoading || isSaving} onChange={onAutoLoginToggle} />
      </Flex>

      <Flex alignItems='center' gap='size-200'>
         <Heading level={4}>Enable OTP Bypass</Heading>
        <TooltipTrigger delay={0}>
          <ActionButton isQuiet aria-label='Set the duration for which the OTP is valid'>
            <Info size='S' />
          </ActionButton>
          <Tooltip>includes the OTP in the response for testing purposes.</Tooltip>
        </TooltipTrigger>
        <Checkbox size='XL' isSelected={otpBypass} isDisabled={isLoading || isSaving} onChange={otpBypassToggle} />
      </Flex>

      <Flex alignItems='center' gap='size-200'>
        <Heading level={4}>OTP expiration validity </Heading>
        <TooltipTrigger delay={0}>
          <ActionButton isQuiet aria-label='Set the duration for which the OTP is valid'>
            <Info size='S' />
          </ActionButton>
          <Tooltip>in minutes</Tooltip>
        </TooltipTrigger>

        <NumberField value={otpValidity} onChange={onOtpValidityChange} minValue={1} step={1} width='size-2000' isDisabled={isLoading || isSaving} />
      </Flex>

      {(isLoading || isSaving) && <ProgressCircle aria-label='loading config' isIndeterminate marginTop='size-100' />}
      {errorMessage && (
        <View marginTop='size-100'>
          <StatusLight variant='negative'>{errorMessage}</StatusLight>
        </View>
      )}

       {successMessage && (
        <View marginTop='size-100'>
          <StatusLight variant='positive'>{successMessage}</StatusLight>
        </View>
      )}

      <Flex marginTop='size-200'>
        <Button variant='accent' onPress={saveConfig} isDisabled={isLoading || isSaving}>Save</Button>
      </Flex>

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

      {/* <Flex marginTop='size-200' gap='size-200' alignItems='center'>
        <Heading level={4}>Business Requirement Document</Heading>
        <a href='#' ></a>
      </Flex>
      <Flex gap='size-200' alignItems='center'>
        <Heading level={4}>Technical Document</Heading>
         <a href='#' ></a>
      </Flex> */}
      <Flex marginTop='size-300' gap='size-200' alignItems='center'>
         <a href='https://documenter.getpostman.com/view/35158574/2sBXcHhJYk#d3985841-bd9e-4dda-8b4e-2c5a181e6245' target="_blank">
         <em>API Documentation</em>
         </a>
      </Flex>
    </View>
  )

  async function loadConfig () {
    setIsLoading(true)
    setErrorMessage(null)
    const actionUrl = allActions['customerotplogin/app_config']
    if (!actionUrl) {
      setErrorMessage('app_config action URL is missing in config.json')
      setIsLoading(false)
      return
    }
    try {
      const response = await actionWebInvoke(actionUrl, getAuthHeaders(), {}, { method: 'GET' })
      setIsEnabled(Boolean(response.is_enabled))
      setAutoLogin(Boolean(response.auto_login))
      setOtpValidity(Number.isInteger(response.otp_expiration_validity) ? response.otp_expiration_validity : 5)
      setOtpBypass(typeof response.otp_in_response === 'boolean' ? response.otp_in_response : true)
      setSuccessMessage(null)
    } catch (e) {
      setErrorMessage(getActionErrorMessage(e, 'load'))
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  function onToggleModule (selected) {
    setIsEnabled(selected)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  function otpBypassToggle (selected) {
    setOtpBypass(selected)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  function onAutoLoginToggle (selected) {
    setAutoLogin(selected)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  function onOtpValidityChange (value) {
    const nextValue = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
    setOtpValidity(nextValue)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  async function saveConfig () {
    setIsSaving(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    let saveFailed = false
    let saveErrorText = ''

    const actionUrl = allActions['customerotplogin/app_config']
    if (!actionUrl) {
      setErrorMessage('app_config action URL is missing in config.json')
      setIsSaving(false)
      return
    }

    try {
      const response = await actionWebInvoke(actionUrl, getAuthHeaders(), { is_enabled: isEnabled, auto_login: autoLogin, otp_expiration_validity: otpValidity, otp_in_response: otpBypass }, { method: 'POST' })
      setIsEnabled(Boolean(response.is_enabled))
      setAutoLogin(Boolean(response.auto_login))
      setOtpValidity(Number.isInteger(response.otp_expiration_validity) ? response.otp_expiration_validity : otpValidity)
      setOtpBypass(typeof response.otp_in_response === 'boolean' ? response.otp_in_response : otpBypass)
    } catch (e) {
      saveFailed = true
      saveErrorText = getActionErrorMessage(e, 'save')
      setErrorMessage(saveErrorText)
      setSaveErrorDialogMessage(saveErrorText)
      setShowSaveErrorDialog(true)
      console.error(e)
    } finally {
      setIsSaving(false)
      await loadConfig()
      if (!saveFailed) {
        setSuccessMessage('Configuration saved')
      }
    }
  }

  function closeSaveErrorDialog () {
    setShowSaveErrorDialog(false)
  }

  function getActionErrorMessage (error, operation) {
    const message = (error && error.message) ? error.message : ''
    if (message.includes('status: 404')) {
      return 'app_config action is not available (404). Restart aio app dev/run or deploy the updated app.'
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