import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore, diffsToUnifiedText, AI_MAX_FILES, type DiffResult } from '../../store'
import { filterToActiveByFileKey, getActivePathspec } from '../../lib/changelists'
import { renderLiteMarkdown } from '../../lib/lite-markdown'

/** Modal that streams an AI code review of the user's staged changes
 *  (falls back to unstaged if nothing is staged — same priority `save_progress`
 *  uses). Output is rendered as basic markdown so headings and bullets read
 *  correctly without pulling in a heavy md parser. */
export function AIReviewModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { repoPath, repoStatus, aiConfig, showToast } = useStore()
  const [content, setContent] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const streamIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    ;(async () => {
      if (!repoPath) { onClose(); return }
      if (!aiConfig.apiKey.trim()) {
        showToast(t('ai_review.no_api_key'), 'error'); onClose(); return
      }
      if (!repoStatus || repoStatus.files.length === 0) {
        showToast(t('ai_review.no_changes'), 'error'); onClose(); return
      }
      // Scope to active changelist so the review covers exactly what
      // save_progress would commit. No-op when no custom groups exist.
      const activePathspec = getActivePathspec(repoStatus.files)
      if (activePathspec !== null && activePathspec.length === 0) {
        showToast(t('ai_review.no_changes'), 'error'); onClose(); return
      }
      const activeFiles = activePathspec === null
        ? repoStatus.files
        : repoStatus.files.filter(f => activePathspec.includes(f.path))
      // Same hard cap as `generateCommitMessage` — see store/index.ts.
      if (activeFiles.length > AI_MAX_FILES) {
        showToast(
          t('toast.ai_too_many_files', { count: activeFiles.length, cap: AI_MAX_FILES }),
          'error',
        )
        onClose()
        return
      }
      const hasStaged = activeFiles.some(f => f.stagedStatus)
      let diffText = ''
      try {
        const allDiffs = await invoke<DiffResult[]>('get_diff', {
          path: repoPath, file: null, staged: hasStaged, commitId: null,
        })
        const diffs = filterToActiveByFileKey(allDiffs, d => d.file)
        diffText = diffsToUnifiedText(diffs)
      } catch (e) {
        if (!cancelled) { setError(String(e)); }
        return
      }
      if (!diffText.trim()) {
        showToast(t('ai_review.no_changes'), 'error'); onClose(); return
      }
      const sid = crypto.randomUUID()
      streamIdRef.current = sid
      unlisten = await listen<{ delta?: string }>(`ai:stream:${sid}`, evt => {
        if (cancelled) return
        const d = evt.payload.delta
        if (typeof d === 'string') setContent(acc => acc + d)
      })
      try {
        const full = await invoke<string>('ai_review_staged', {
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model.trim() || null,
          baseUrl: aiConfig.baseUrl.trim() || null,
          diff: diffText,
          streamId: sid,
        })
        if (!cancelled) {
          setContent(full)
          setDone(true)
        }
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
          <i className="ti ti-sparkles" style={{ marginRight: 6 }} />
          {t('ai_review.title')}
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
