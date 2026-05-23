import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'

interface Props {
  onClose: () => void
}

interface Item {
  kind: 'open' | 'recent'
  name: string
  path: string
}

/**
 * ⌘P repo quick-switcher. Modal overlay with a single text input that
 * fuzzy-matches against open tabs (first) and not-yet-open recents
 * (second). Up/Down to navigate, Enter to switch (or open), Esc to
 * close. Sister UI to the left RepoListSidebar — that's the visible
 * always-on listing, this is the keyboard speedrun.
 */
export function RepoPalette({ onClose }: Props) {
  const { t } = useTranslation()
  const { tabs, recentRepos, switchTab, openRepo } = useStore()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input on open. requestAnimationFrame so the modal is in
  // the DOM before we try to focus.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Build the candidate list — open tabs always come first, recents
  // (excluding any currently-open) follow. Fuzzy match is character-
  // subsequence based: every char of the query must appear in order in
  // the candidate string. Cheap, no deps.
  const items: Item[] = useMemo(() => {
    const tabsList: Item[] = tabs.map(t => ({
      kind: 'open',
      name: t.name,
      path: t.root,
    }))
    const openRoots = new Set(tabs.map(t => t.root))
    const recents: Item[] = recentRepos
      .filter(r => !openRoots.has(r.path))
      .map(r => ({ kind: 'recent', name: r.name, path: r.path }))
    const all = [...tabsList, ...recents]
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(item => {
      const hay = `${item.name} ${item.path}`.toLowerCase()
      let i = 0
      for (const ch of q) {
        i = hay.indexOf(ch, i)
        if (i === -1) return false
        i++
      }
      return true
    })
  }, [tabs, recentRepos, query])

  // Reset cursor when results change.
  useEffect(() => { setCursor(0) }, [query])

  const commit = (item: Item) => {
    if (item.kind === 'open') {
      switchTab(item.path)
    } else {
      void openRepo(item.path)
    }
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, items.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[cursor]
      if (item) commit(item)
    }
  }

  return (
    <div className="repo-palette-backdrop" onClick={onClose}>
      <div
        className="repo-palette"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={t('repo_palette.aria_label')}
      >
        <div className="repo-palette-input-row">
          <i className="ti ti-search" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('repo_palette.placeholder')}
          />
          <span className="repo-palette-hint">{t('repo_palette.hint')}</span>
        </div>
        <div className="repo-palette-list">
          {items.length === 0 && (
            <div className="repo-palette-empty">{t('repo_palette.empty')}</div>
          )}
          {items.map((item, i) => (
            <button
              key={`${item.kind}-${item.path}`}
              className={`repo-palette-row ${i === cursor ? 'active' : ''}`}
              onClick={() => commit(item)}
              onMouseEnter={() => setCursor(i)}
            >
              <i className={`ti ${item.kind === 'open' ? 'ti-folder-open' : 'ti-folder'}`} />
              <div className="repo-palette-row-text">
                <span className="repo-palette-row-name">{item.name}</span>
                <span className="repo-palette-row-path">{item.path}</span>
              </div>
              {item.kind === 'open' && (
                <span className="repo-palette-row-tag">{t('repo_palette.open_tag')}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
