/**
 * Pattern-match editor / OS temporary files that users almost never care to
 * see in the unstaged file list. The default behavior is to HIDE these in
 * the Sidebar (Settings → "show editor temp files" can opt back in).
 *
 * Hiding is display-only — git status still sees them, push/commit logic is
 * unaffected. So if the user opens vim and the swap file briefly appears in
 * `git status`, Versa just doesn't surface it in the sidebar; the file is
 * still on disk, still untracked, and once vim exits cleanly the swap is
 * gone anyway.
 *
 * Patterns covered:
 *   - vim swap:    `.{name}.sw[a-p]`     (e.g. `.foo.swp`, `.foo.swo`)
 *   - vim atomic:  `4913`                (briefly created during :w)
 *   - emacs lock:  `.#{name}`            (e.g. `.#main.tsx`)
 *   - emacs save:  `#{name}#`            (e.g. `#main.tsx#`)
 *   - backup:      `{name}~`             (vim/emacs/many)
 *   - macOS:       `.DS_Store`
 *   - Windows:     `Thumbs.db`, `desktop.ini`
 */
export function isEditorTempFile(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  if (!name) return false
  if (name === '.DS_Store') return true
  if (name === 'Thumbs.db') return true
  if (name === 'desktop.ini') return true
  if (name === '4913') return true
  if (/\.sw[a-p]$/.test(name)) return true   // .swp / .swo / .swn / ...
  if (/~$/.test(name)) return true            // foo.txt~ backup
  if (/^\.#/.test(name)) return true          // emacs lock
  if (/^#.*#$/.test(name)) return true        // emacs auto-save
  return false
}
