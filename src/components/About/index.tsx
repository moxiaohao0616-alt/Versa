import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'

interface Diagnostics {
  appVersion: string
  tauriVersion: string
  rustcTarget: string
  os: string
  arch: string
  gitVersion: string | null
  gitLfsVersion: string | null
  libgit2Version: string
  currentRepo: string | null
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  const { repoPath, showToast } = useStore()
  const [info, setInfo] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try { setInfo(await invoke<Diagnostics>('get_diagnostics', { repoPath })) }
      finally { setLoading(false) }
    })()
  }, [repoPath])

  const text = info ? buildText(info) : ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
          关于 Versa
        </div>
        <div className="about-body">
          <div className="about-hero">
            <div className="about-logo">V</div>
            <div>
              <div className="about-name">Versa</div>
              <div className="about-tagline">Git for Everyone</div>
            </div>
          </div>
          {loading || !info ? (
            <p className="rs-empty">加载诊断信息中…</p>
          ) : (
            <dl className="about-grid">
              <dt>版本</dt>            <dd>{info.appVersion}</dd>
              <dt>Tauri</dt>           <dd>{info.tauriVersion}</dd>
              <dt>libgit2</dt>         <dd>{info.libgit2Version}</dd>
              <dt>git CLI</dt>         <dd>{info.gitVersion || <em>未检测到</em>}</dd>
              <dt>git-lfs</dt>         <dd>{info.gitLfsVersion || <em>未安装</em>}</dd>
              <dt>系统</dt>            <dd>{info.os} · {info.arch}</dd>
              <dt>当前仓库</dt>        <dd className="about-path">{info.currentRepo || <em>未打开</em>}</dd>
            </dl>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>关闭</button>
          <button
            className="btn-primary"
            disabled={!info}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                showToast('诊断信息已复制', 'success')
              } catch (e) {
                showToast(String(e), 'error')
              }
            }}
          >
            <i className="ti ti-copy" />
            复制诊断信息
          </button>
        </div>
      </div>
    </div>
  )
}

function buildText(d: Diagnostics): string {
  return [
    `Versa ${d.appVersion}`,
    `Tauri ${d.tauriVersion} · libgit2 ${d.libgit2Version}`,
    `git: ${d.gitVersion ?? 'not found'}`,
    `git-lfs: ${d.gitLfsVersion ?? 'not installed'}`,
    `OS: ${d.os} ${d.arch}`,
    `repo: ${d.currentRepo ?? '(none)'}`,
  ].join('\n')
}
