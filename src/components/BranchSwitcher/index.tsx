import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'

/** Click-to-switch branch widget. Renders the current branch name + a
 *  dropdown of all local branches plus a "new branch" inline input.
 *
 *  Self-contained — drop it anywhere a current-branch indicator is wanted
 *  and clicking it switches branches. We render two visual variants via
 *  the `variant` prop:
 *    "indicator" — minimal text+icon, looks like a label (titlebar style)
 *    "pill"      — full pill chip with blue bg (sidebar style)
 */
export function BranchSwitcher({
  variant = 'pill',
}: {
  variant?: 'pill' | 'indicator'
}) {
  const { t } = useTranslation()
  const { repoPath, repoStatus, switchBranch, createBranch } = useStore()

  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [newBranchVisible, setNewBranchVisible] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const newBranchInputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setNewBranchVisible(false)
        setNewBranchName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (newBranchVisible) newBranchInputRef.current?.focus()
  }, [newBranchVisible])

  if (!repoStatus) return null
  const branch = repoStatus.branch

  const handleClick = async () => {
    if (!repoPath) return
    if (!open) {
      const list = await invoke<string[]>('get_branches', { path: repoPath })
      setBranches(list)
    }
    setOpen(v => !v)
    setNewBranchVisible(false)
    setNewBranchName('')
  }

  const handleSelect = async (name: string) => {
    setOpen(false)
    if (name !== branch) await switchBranch(name)
  }

  const handleCreate = async () => {
    const name = newBranchName.trim()
    if (!name) return
    setOpen(false)
    setNewBranchVisible(false)
    setNewBranchName('')
    await createBranch(name)
  }

  return (
    <div className={`branch-switcher branch-switcher-${variant}`} ref={rootRef}>
      <button
        className={variant === 'pill' ? 'branch-pill' : 'branch-indicator-btn'}
        onClick={handleClick}
        title={branch}
      >
        <i className="ti ti-git-branch" />
        <span className="branch-pill-name">{branch}</span>
        <i className="ti ti-chevron-down" />
      </button>
      {open && (
        <div className="branch-dropdown">
          {branches.map(b => (
            <button
              key={b}
              className={`branch-dropdown-item ${b === branch ? 'active' : ''}`}
              onClick={() => handleSelect(b)}
            >
              <i className="ti ti-git-branch" />
              <span className="branch-dropdown-name">{b}</span>
              {b === branch && <i className="ti ti-check" style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
          <div className="repo-dropdown-divider" />
          {newBranchVisible ? (
            <div className="new-branch-row">
              <i className="ti ti-git-branch" />
              <input
                ref={newBranchInputRef}
                className="new-branch-input"
                placeholder={t('sidebar.new_branch_placeholder')}
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') { setNewBranchVisible(false); setNewBranchName('') }
                }}
              />
              <button className="new-branch-confirm" onClick={handleCreate} disabled={!newBranchName.trim()}>
                {t('sidebar.confirm_create')}
              </button>
            </div>
          ) : (
            <button className="branch-dropdown-item" onClick={() => setNewBranchVisible(true)}>
              <i className="ti ti-plus" />
              <span>{t('sidebar.new_branch')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
