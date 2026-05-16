import i18n from '../i18n'

/** Human-readable "N units ago" string. Honors the current UI language so
 *  English users see "5m ago" instead of "5 分钟前". */
export function relTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const s = Math.floor(Date.now() / 1000 - ts)
  const en = i18n.language.startsWith('en')
  if (s < 60)         return en ? 'just now'                       : '刚刚'
  if (s < 3600)       return en ? `${Math.floor(s / 60)}m ago`     : `${Math.floor(s / 60)} 分钟前`
  if (s < 86400)      return en ? `${Math.floor(s / 3600)}h ago`   : `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 30) return en ? `${Math.floor(s / 86400)}d ago`  : `${Math.floor(s / 86400)} 天前`
  return new Date(ts * 1000).toLocaleDateString(en ? 'en-US' : 'zh-CN')
}
