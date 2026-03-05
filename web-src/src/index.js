/* 
* <license header>
*/

import 'core-js/stable'
import 'regenerator-runtime/runtime'
import ReactDOM from 'react-dom'

import App from './components/App'
import './index.css'

window.React = require('react')
bootstrapRaw()

function bootstrapRaw () {
  /* Commerce context is populated in ExtensionRegistration via @adobe/uix-guest */
  const mockRuntime = { on: () => {} }
  const mockIms = {}

  // render the actual react application and pass along the runtime object to make it available to the App
  ReactDOM.render(
    <App runtime={mockRuntime} ims={mockIms} />,
    document.getElementById('root')
  )
}
