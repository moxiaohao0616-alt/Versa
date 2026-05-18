import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore, type CommitInfo } from '../../store'
import { renderLiteMarkdown } from '../../lib/lite-markdown'

interface Props {
  base: string
  head: string
  commits: CommitInfo[]
  diff: string                  // unified diff text already prepared
  onClose: () => void
}

/** AI-generated GitHub PR description from the current Compare view's
 *  commits + combined diff. Renders streamed markdown and offers a copy
 *  button for pasting into the PR body. */
export function AIPrDescriptionModal({ base, head, commits, diff, onClose }: Props) {
  const { t } = useTranslation()
  const { aiConfig, showToast } = useStore()
  const [content, setContent] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const streamIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    ;(async () => {
      if (!aiConfig.apiKey.trim()) {
        showToast(t('ai_review.no_api_key'), 'error'); onClose(); return
      }
      const sid = crypto.randomUUID()
      streamIdRef.current = sid
      unlisten = await listen<{ delta?: string }>(`ai:stream:${sid}`, evt => {
        if (cancelled) return
        const d = evt.payload.delta
        if (typeof d === 'string') setContent(acc => acc + d)
      })
      try {
        const full = await invoke<string>('ai_pr_description', {
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model.trim() || null,
          baseUrl: aiConfig.baseUrl.trim() || null,
          baseBranch: base,
          headBranch: head,
          commits: commits.map(c => `${c.shortId} ${c.message}`),
          diff,
          streamId: sid,
        })
        if (!cancelled) { setContent(full); setDone(true) }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        unlisten?.()
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
      const sid = streamIdRef.current
      if (sid) invoke('cancel_ai_stream', { streamId: sid }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) { showToast(String(e), 'error') }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide ai-review-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-file-text-ai" style={{ marginRight: 6 }} />
          {t('ai_pr.title')}
          <span className="ai-review-sub">{base} → {head}</span>
          {!done && !error && (
            <span className="ai-review-status">
              <i className="ti ti-loader-2" /> {t('ai_review.streaming')}
            </span>
          )}
        </div>
        <div className="ai-review-body">
          {error ? (
            <div className="ai-review-error">
              <i className="ti ti-alert-circle" /> {error}
            </div>
          ) : content ? (
            <div className="ai-review-content" dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(content) }} />
          ) : done ? (
            <div className="ai-review-error">
              <i className="ti ti-alert-circle" /> {t('ai_review.empty_response')}
            </div>
          ) : (
            <div className="ai-review-placeholder">
              <i className="ti ti-loader-2" />
              <p>{t('ai_review.warming_up')}</p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {content && (
            <button className="btn-secondary" onClick={copy}>
              <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} />
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {done || error ? t('common.close') : t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
