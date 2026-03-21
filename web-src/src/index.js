/* 
* <license header>
*/

import 'core-js/stable'
import 'regenerator-runtime/runtime'
import ReactDOM from 'react-dom'

import App from './components/App'
import './index.css'

window.React = require('react')

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

if (!isLocal && window.location !== window.parent.location) {
  // Running inside EXC shell (iframe) — use @adobe/exc-app for IMS context
  import('@adobe/exc-app').then(({ init }) => {
    init().then(runtime => {
      const ims = {}
      runtime.on('ready', ({ imsOrg, imsToken, locale }) => {
        console.log('EXC ready — IMS context received')
        ims.org = imsOrg
        ims.token = imsToken
        render(runtime, ims)
      })
      runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
        ims.org = imsOrg
        ims.token = imsToken
      })
    })
  }).catch(() => bootstrapRaw())
} else {
  // Local dev or standalone — bootstrap directly
  console.log('Running in standalone/local mode')
  bootstrapRaw()
}

function render (runtime, ims) {
  ReactDOM.render(
    <App runtime={runtime} ims={ims} />,
    document.getElementById('root')
  )
}

function bootstrapRaw () {
  const mockRuntime = { on: () => {} }
  const mockIms = {}
  render(mockRuntime, mockIms)
}
