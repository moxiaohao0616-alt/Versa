/** Tiny safe-ish markdown → HTML for AI output panels.
 *  Supports: ## heading, - bullet list, - [ ] / - [x] checkboxes,
 *  `inline code`, **bold**, plain paragraphs. Nothing else — keep it
 *  small and predictable. HTML special chars are escaped first, then a
 *  small set of pattern replacements re-introduces safe tags. */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineFmt(s: string): string {
  // Inline code first so its content can't be re-formatted.
  let out = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out
}

export function renderLiteMarkdown(text: string): string {
  const lines = escapeHtml(text).split('\n')
  const out: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false }
  }

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      closeList()
      continue
    }
    // Heading: `## title` (and ### / # as fallback)
    const hm = line.match(/^(#{1,6})\s+(.+)$/)
    if (hm) {
      closeList()
      const level = Math.min(hm[1].length + 1, 6) // ## → h3 etc. (h1/h2 reserved for the modal title)
      out.push(`<h${level}>${inlineFmt(hm[2])}</h${level}>`)
      continue
    }
    // Bullet / checkbox
    const bm = line.match(/^\s*-\s+(\[( |x|X)\]\s+)?(.+)$/)
    if (bm) {
      if (!inList) { out.push('<ul>'); inList = true }
      if (bm[1]) {
        const checked = (bm[2] || '').toLowerCase() === 'x'
        out.push(
          `<li class="cb"><span class="cb-box ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span>${inlineFmt(bm[3])}</li>`,
        )
      } else {
        out.push(`<li>${inlineFmt(bm[1] ? bm[3] : bm[3])}</li>`)
      }
      continue
    }
    // Plain paragraph
    closeList()
    out.push(`<p>${inlineFmt(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
