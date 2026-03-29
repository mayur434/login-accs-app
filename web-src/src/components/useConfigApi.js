import { useCallback, useEffect, useRef, useState } from 'react'
import allActions from '../config.json'
import actionWebInvoke from '../utils'

/**
 * Shared hook for loading / saving the unified app_config.
 * Every admin page uses the same backend action – this hook centralises
 * the fetch / persist logic so each page can focus on its own fields.
 *
 * @param {object} ims       – { token, org } from Adobe IMS
 * @param {function} mapLoad – (response) => formState object
 * @param {function} mapSave – (formState) => request payload object
 */
export default function useConfigApi (ims, mapLoad, mapSave) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const savedRef = useRef(null)
  const formRef = useRef(null)

  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  // ── Auth ────────────────────────────────────────────────────────
  function getAuthHeaders () {
    const headers = {}
    if (ims?.token) headers.authorization = `Bearer ${ims.token}`
    if (ims?.org) headers['x-gw-ims-org-id'] = ims.org
    return headers
  }

  // ── Load ────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    const authHeaders = getAuthHeaders()
    if (!authHeaders.authorization && !isLocal) {
      setErrorMessage('Missing Adobe IMS session.')
      setIsLoading(false)
      return null
    }

    const actionUrl = allActions['login-module/config']
    if (!actionUrl) {
      setErrorMessage('config action URL is missing in config.json')
      setIsLoading(false)
      return null
    }

    try {
      const response = await actionWebInvoke(actionUrl, authHeaders, {}, { method: 'GET' })
      const loaded = mapLoad(response)
      savedRef.current = loaded
      formRef.current = loaded
      setIsLoading(false)
      return loaded
    } catch (e) {
      setErrorMessage('Failed to load configuration: ' + e.message)
      setIsLoading(false)
      return null
    }
  }, [ims?.token, ims?.org])

  // ── Save ────────────────────────────────────────────────────────
  const saveConfig = useCallback(async (formState) => {
    setIsSaving(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    const authHeaders = getAuthHeaders()
    const actionUrl = allActions['login-module/config']
    if (!actionUrl) {
      setErrorMessage('config action URL is missing in config.json')
      setIsSaving(false)
      return false
    }

    try {
      const payload = mapSave(formState)
      await actionWebInvoke(actionUrl, authHeaders, payload, { method: 'POST' })
      savedRef.current = { ...formState }
      setSuccessMessage('Configuration saved successfully.')
      setIsSaving(false)
      return true
    } catch (e) {
      setErrorMessage('Failed to save: ' + e.message)
      setIsSaving(false)
      return false
    }
  }, [ims?.token, ims?.org])

  // ── Auto-dismiss success ────────────────────────────────────────
  const timer = useRef(null)
  useEffect(() => {
    if (successMessage) {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSuccessMessage(null), 4000)
    }
    return () => clearTimeout(timer.current)
  }, [successMessage])

  return {
    isLoading, isSaving, errorMessage, successMessage,
    setErrorMessage, setSuccessMessage,
    savedRef, loadConfig, saveConfig, isLocal
  }
}
