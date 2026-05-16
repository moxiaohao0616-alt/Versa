import { useTranslation } from 'react-i18next'

/** Global keyboard cheatsheet. Opened by pressing `?` (no modifier) anywhere
 *  outside an editable element. Keep grouped + ordered for scanability. */

type Shortcut = { keys: string[]; desc: string }
type Group = { title: string; items: Shortcut[] }

// Pick the right modifier symbol for the platform.
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

export function CheatsheetModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()

  const groups: Group[] = [
    {
      title: t('cheatsheet.group_general'),
      items: [
        { keys: ['?'],          desc: t('cheatsheet.open_panel') },
        { keys: ['Esc'],        desc: t('cheatsheet.cancel_modal') },
        { keys: [MOD, '`'],     desc: t('cheatsheet.toggle_terminal') },
      ],
    },
    {
      title: t('cheatsheet.group_tabs'),
      items: [
        { keys: [MOD, 'W'],            desc: t('cheatsheet.close_tab') },
        { keys: [MOD, '⇧', ']'],       desc: t('cheatsheet.next_tab') },
        { keys: [MOD, '⇧', '['],       desc: t('cheatsheet.prev_tab') },
      ],
    },
    {
      title: t('cheatsheet.group_diff'),
      items: [
        { keys: [MOD, 'F'],   desc: t('cheatsheet.search_diff') },
        { keys: [MOD, '↑'],   desc: t('cheatsheet.prev_file') },
        { keys: [MOD, '↓'],   desc: t('cheatsheet.next_file') },
        { keys: ['Alt', '↑'], desc: t('cheatsheet.prev_hunk') },
        { keys: ['Alt', '↓'], desc: t('cheatsheet.next_hunk') },
      ],
    },
    {
      title: t('cheatsheet.group_history'),
      items: [
        { keys: [t('cheatsheet.dblclick_branch')], desc: t('cheatsheet.dblclick_branch_desc') },
        { keys: [t('cheatsheet.dblclick_commit')], desc: t('cheatsheet.dblclick_commit_desc') },
        { keys: [t('cheatsheet.kebab')],           desc: t('cheatsheet.kebab_desc') },
      ],
    },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide cheatsheet-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-command" style={{ marginRight: 6 }} />
          {t('cheatsheet.title')}
        </div>
        <div className="cheatsheet-body">
          {groups.map(g => (
            <section key={g.title} className="cheatsheet-section">
              <h4>{g.title}</h4>
              <ul>
                {g.items.map((it, i) => (
                  <li key={i}>
                    <span className="cheatsheet-desc">{it.desc}</span>
                    <span className="cheatsheet-keys">
                      {it.keys.map((k, ki) => (
                        <kbd key={ki}>{k}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('cheatsheet.close_hint')}</button>
        </div>
      </div>
    </div>
  )
}
