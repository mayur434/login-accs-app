import { register } from '@adobe/uix-guest'
import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import AdminUi from './AdminUi'

export default function ExtensionRegistration (props) {
  const [imsContext, setImsContext] = useState(props.ims || {})

  useEffect(() => {
    init(setImsContext, props.ims).catch(console.error)
  }, [])

  return <AdminUi ims={imsContext} runtime={props.runtime} />
}

const init = async (setImsContext, fallbackIms = {}) => {
  const extensionId = 'customer-module'

  const guest = await register({
    id: extensionId,
    methods: {
    }
  })

  const nextIms = await resolveImsContextOnce(guest, fallbackIms)
  setImsContext(nextIms)
  console.log('uix-guest ims context', { hasToken: Boolean(nextIms && nextIms.token), org: nextIms && nextIms.org })
}

function resolveImsContextOnce (guest, fallbackIms = {}, timeoutMs = 5000) {
  const initialIms = getImsFromGuestContext(guest, fallbackIms)
  if (initialIms && initialIms.token) {
    return Promise.resolve(initialIms)
  }

  return new Promise((resolve) => {
    let settled = false
    let timeoutId = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (guest && typeof guest.removeEventListener === 'function') {
        guest.removeEventListener('connected', handleEvent)
        guest.removeEventListener('contextchange', handleEvent)
      }
    }

    const resolveOnce = (ims) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(ims)
    }

    const handleEvent = () => {
      const nextIms = getImsFromGuestContext(guest, fallbackIms)
      if (nextIms && nextIms.token) {
        resolveOnce(nextIms)
      }
    }

    if (guest && typeof guest.addEventListener === 'function') {
      guest.addEventListener('connected', handleEvent)
      guest.addEventListener('contextchange', handleEvent)
    }

    timeoutId = setTimeout(() => {
      resolveOnce(getImsFromGuestContext(guest, fallbackIms))
    }, timeoutMs)
  })
}

function getImsFromGuestContext (guest, fallbackIms = {}) {
  const read = (key) => {
    try {
      return guest && guest.sharedContext && guest.sharedContext.get
        ? guest.sharedContext.get(key)
        : undefined
    } catch {
      return undefined
    }
  }

  const imsObj = read('ims') || {}
  const authObj = read('auth') || {}

  const token = read('imsToken') || read('accessToken') || imsObj.token || authObj.imsToken || authObj.accessToken || fallbackIms.token
  const org = read('imsOrg') || read('imsOrgId') || read('orgId') || imsObj.org || authObj.imsOrg || authObj.org || fallbackIms.org
  const profile = read('imsProfile') || read('profile') || imsObj.profile || authObj.profile || fallbackIms.profile

  return {
    ...fallbackIms,
    token,
    org,
    profile
  }
}

ExtensionRegistration.propTypes = {
  ims: PropTypes.any,
  runtime: PropTypes.any
}