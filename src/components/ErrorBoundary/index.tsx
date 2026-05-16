import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '../../i18n'

interface State {
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

/** Catches all React render-time exceptions and presents a copy-pasteable
 *  bug report instead of a white screen. The "复制诊断信息" button bundles
 *  the stack trace with the same diagnostic info shown in the About modal,
 *  so users can paste a single block to the developer. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    // Always print to the console too — Tauri devtools is the first thing
    // we look at when triaging.
    // eslint-disable-next-line no-console
    console.error('[Versa ErrorBoundary]', error, errorInfo)
  }

  copyReport = async () => {
    const { error, errorInfo } = this.state
    let diag = ''
    try {
      const d = await invoke<{
        appVersion: string; tauriVersion: string; libgit2Version: string;
        gitVersion: string | null; gitLfsVersion: string | null;
        os: string; arch: string; currentRepo: string | null;
      }>('get_diagnostics', { repoPath: null })
      diag = [
        `Versa ${d.appVersion}`,
        `Tauri ${d.tauriVersion} · libgit2 ${d.libgit2Version}`,
        `git: ${d.gitVersion ?? 'not found'}`,
        `git-lfs: ${d.gitLfsVersion ?? 'not installed'}`,
        `OS: ${d.os} ${d.arch}`,
        `repo: ${d.currentRepo ?? '(none)'}`,
      ].join('\n')
    } catch {
      diag = '(failed to collect diagnostic info)'
    }
    const report = [
      '## Versa 崩溃报告',
      '',
      '### 环境',
      diag,
      '',
      '### 错误',
      '```',
      error?.message ?? '(no message)',
      error?.stack ?? '(no stack)',
      '```',
      '',
      '### 组件栈',
      '```',
      errorInfo?.componentStack ?? '(none)',
      '```',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(report)
    } catch {
      // Fallback: open the report in an alert so the user can manually copy.
      // eslint-disable-next-line no-alert
      alert(report)
    }
  }

  reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    // i18next isn't easily available in a classy component without HOC, so use
    // the standalone i18n instance directly.
    const t = i18n.t.bind(i18n)
    return (
      <div className="errboundary">
        <div className="errboundary-card">
          <div className="errboundary-icon">
            <i className="ti ti-alert-triangle" />
          </div>
          <h2>{t('err.boundary_title')}</h2>
          <p className="errboundary-sub">{t('err.boundary_sub')}</p>
          <pre className="errboundary-message">{this.state.error.message}</pre>
          <div className="errboundary-actions">
            <button className="btn-primary" onClick={this.copyReport}>
              <i className="ti ti-copy" />
              {t('err.boundary_copy')}
            </button>
            <button className="btn-secondary" onClick={this.reload}>
              <i className="ti ti-refresh" />
              {t('err.boundary_reload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
