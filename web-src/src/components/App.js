/* 
* <license header>
*/

import React from 'react'
import { Provider, defaultTheme, Grid, View } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import SideBar from './SideBar'
import AdminUi from './AdminUi'
import SmsConfigUi from './SmsConfigUi'
import EmailConfigUi from './EmailConfigUi'
import ExtensionRegistration from './ExtensionRegistration'

function App (props) {
  console.log('runtime object:', props.runtime)
  console.log('ims object:', props.ims)

  // use exc runtime event handlers
  // respond to configuration change events (e.g. user switches org)
  props.runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
    console.log('configuration change', { imsOrg, imsToken, locale })
  })
  // respond to history change events
  props.runtime.on('history', ({ type, path }) => {
    console.log('history change', { type, path })
  })

  return (
    <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
      <Router>
        <Provider theme={defaultTheme} colorScheme={'light'}>
          <Grid
            areas={['sidebar content']}
            columns={['256px', '1fr']}
            rows={['auto']}
            height='100vh'
            gap='size-0'
          >
            <View
              gridArea='sidebar'
              backgroundColor='gray-100'
              borderEndWidth='thin'
              borderEndColor='gray-300'
              UNSAFE_style={{ minHeight: '100vh' }}
            >
              <SideBar />
            </View>
            <View gridArea='content' padding='size-400' UNSAFE_style={{ overflowY: 'auto' }}>
              <Routes>
                <Route path='/' element={<ExtensionRegistration runtime={props.runtime} ims={props.ims} />} />
                <Route path='/admin' element={<AdminUi ims={props.ims} />} />
                <Route path='/admin/sms' element={<SmsConfigUi ims={props.ims} />} />
                <Route path='/admin/email' element={<EmailConfigUi ims={props.ims} />} />
                <Route path='*' element={<Navigate to='/admin' replace />} />
              </Routes>
            </View>
          </Grid>
        </Provider>
      </Router>
    </ErrorBoundary>
  )

  // Methods

  // error handler on UI rendering failure
  function onError (e, componentStack) { }

  // component to show if UI fails rendering
  function fallbackComponent ({ componentStack, error }) {
    return (
      <React.Fragment>
        <h1 style={{ textAlign: 'center', marginTop: '20px' }}>
          Something went wrong :(
        </h1>
        <pre>{componentStack + '\n' + error.message}</pre>
      </React.Fragment>
    )
  }
}

export default App
