import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { bootSyncRunner } from './cloud/syncRunner'
import { bootChangelistRunner } from './lib/changelists'
import './i18n'

// Wire the cloud sync runner once at app startup. No network requests fire
// until the user signs in — until then this is just a Zustand subscription.
bootSyncRunner()
// Wire changelists: auto-load per-repo state + auto-assign new unstaged files
// to the active group.
bootChangelistRunner()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
