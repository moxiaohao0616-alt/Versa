/** Global keyboard cheatsheet. Opened by pressing `?` (no modifier) anywhere
 *  outside an editable element. Keep grouped + ordered for scanability. */

type Shortcut = { keys: string[]; desc: string }
type Group = { title: string; items: Shortcut[] }

// Pick the right modifier symbol for the platform.
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

const GROUPS: Group[] = [
  {
    title: '通用',
    items: [
      { keys: ['?'],          desc: '打开这个快捷键面板' },
      { keys: ['Esc'],        desc: '关闭弹层 / 取消正在跑的 AI' },
      { keys: [MOD, '`'],     desc: '切换 Terminal' },
    ],
  },
  {
    title: '多仓库 Tab',
    items: [
      { keys: [MOD, 'W'],            desc: '关闭当前仓库 tab' },
      { keys: [MOD, '⇧', ']'],       desc: '切到下一个 tab' },
      { keys: [MOD, '⇧', '['],       desc: '切到上一个 tab' },
    ],
  },
  {
    title: 'Diff 查看',
    items: [
      { keys: [MOD, 'F'],   desc: '在当前 diff 里搜文本' },
      { keys: [MOD, '↑'],   desc: '上一个文件' },
      { keys: [MOD, '↓'],   desc: '下一个文件' },
      { keys: ['Alt', '↑'], desc: '上一处改动（hunk）' },
      { keys: ['Alt', '↓'], desc: '下一处改动（hunk）' },
    ],
  },
  {
    title: '提交 / 历史',
    items: [
      { keys: ['双击分支'], desc: '切换分支（本地）/ 在本地创建并切换（远程）' },
      { keys: ['双击 commit'], desc: '查看那次的改动' },
      { keys: ['⋮'],         desc: '在分支 / commit 行的右侧打开操作菜单' },
    ],
  },
]

export function CheatsheetModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide cheatsheet-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-command" style={{ marginRight: 6 }} />
          快捷键
        </div>
        <div className="cheatsheet-body">
          {GROUPS.map(g => (
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
          <button className="btn-secondary" onClick={onClose}>关闭（Esc）</button>
        </div>
      </div>
    </div>
  )
}
