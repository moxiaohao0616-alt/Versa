import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import type { AIProvider, RemoteInfo, LfsStatus, LfsPattern, LfsFile } from '../../store'
import { AboutModal } from '../About'
import { CheatsheetModal } from '../Cheatsheet'
import { setLanguage } from '../../i18n'

type Theme = 'light' | 'dark' | 'system'

const THEMES: { value: Theme; label: string; previewClass: string }[] = [
  { value: 'light',  label: '浅色',    previewClass: 'tp-light' },
  { value: 'dark',   label: '深色',    previewClass: 'tp-dark'  },
  { value: 'system', label: '跟随系统', previewClass: 'tp-sys'   },
]

interface ProviderMeta {
  value: AIProvider
  label: string
  hint: string
  defaultModel: string
  /** When true, hide the Base URL field — backend has a preset. */
  hasPresetBaseUrl: boolean
  /** Hint shown above the API key input. */
  keyPlaceholder: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    hint: '官方 Claude API · api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    hasPresetBaseUrl: true,
    keyPlaceholder: 'sk-ant-...',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    hint: '官方 GPT 系列 · api.openai.com',
    defaultModel: 'gpt-4o-mini',
    hasPresetBaseUrl: true,
    keyPlaceholder: 'sk-...',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    hint: '深度求索 · api.deepseek.com',
    defaultModel: 'deepseek-chat',
    hasPresetBaseUrl: true,
    keyPlaceholder: 'sk-...',
  },
  {
    value: 'kimi',
    label: 'Kimi (Moonshot)',
    hint: '月之暗面 · api.moonshot.cn',
    defaultModel: 'moonshot-v1-32k',
    hasPresetBaseUrl: true,
    keyPlaceholder: 'sk-...',
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI 兼容',
    hint: '自定义 base URL · 本地 vLLM、Ollama、其他第三方',
    defaultModel: '',
    hasPresetBaseUrl: false,
    keyPlaceholder: 'sk-...',
  },
]

const PROVIDER_MAP = new Map(PROVIDERS.map(p => [p.value, p]))

type SubPage = 'main' | 'ai' | 'remotes' | 'lfs'

export function Settings() {
  const [page, setPage] = useState<SubPage>('main')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  let view
  if (page === 'ai')           view = <AISettings onBack={() => setPage('main')} />
  else if (page === 'remotes') view = <RemotesSettings onBack={() => setPage('main')} />
  else if (page === 'lfs')     view = <LfsSettings onBack={() => setPage('main')} />
  else view = (
    <MainSettings
      onOpenAI={() => setPage('ai')}
      onOpenRemotes={() => setPage('remotes')}
      onOpenLfs={() => setPage('lfs')}
      onOpenAbout={() => setAboutOpen(true)}
      onOpenShortcuts={() => setShortcutsOpen(true)}
    />
  )
  return <>
    {view}
    {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    {shortcutsOpen && <CheatsheetModal onClose={() => setShortcutsOpen(false)} />}
  </>
}

// ── Main settings list ────────────────────────────────────────────────────

function MainSettings({
  onOpenAI,
  onOpenRemotes,
  onOpenLfs,
  onOpenAbout,
  onOpenShortcuts,
}: {
  onOpenAI: () => void
  onOpenRemotes: () => void
  onOpenLfs: () => void
  onOpenAbout: () => void
  onOpenShortcuts: () => void
}) {
  const { theme, setTheme, aiConfig, graphLoadStep, setGraphLoadStep, gpgSign, setGpgSign } = useStore()
  const { i18n } = useTranslation()
  const providerLabel = PROVIDER_MAP.get(aiConfig.provider)?.label ?? '未配置'
  const aiConfigured = aiConfig.apiKey.trim().length > 0

  return (
    <div className="settings-view">
      <h2 className="settings-page-title">设置</h2>

      <div className="settings-section">
        <p className="settings-section-title">通用</p>

        <div className="settings-row">
          <div>
            <p className="settings-row-label">主题</p>
            <p className="settings-row-desc">选择界面外观，或跟随系统自动切换</p>
          </div>
          <div className="theme-picker">
            {THEMES.map(t => (
              <button
                key={t.value}
                className={`theme-card ${theme === t.value ? 'selected' : ''}`}
                onClick={() => setTheme(t.value)}
                aria-pressed={theme === t.value}
              >
                <div className={`theme-preview ${t.previewClass}`}>
                  <div className="tp-bar" />
                  <div className="tp-lines">
                    <div className="tp-line" />
                    <div className="tp-line" />
                  </div>
                </div>
                <span className="theme-card-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <p className="settings-row-label">提交历史 · 每次加载</p>
            <p className="settings-row-desc">
              "再加载" 按钮每点一次拉多少条提交。50–2000 之间。
            </p>
          </div>
          <input
            className="settings-input"
            type="number"
            min={50}
            max={2000}
            step={50}
            style={{ width: 96, textAlign: 'center' }}
            value={graphLoadStep}
            onChange={e => setGraphLoadStep(Number(e.target.value))}
          />
        </div>

        <div className="settings-row">
          <div>
            <p className="settings-row-label">界面语言 · Language</p>
            <p className="settings-row-desc">
              切换 Versa 自身 UI 的语言（不影响仓库内容）。i18n 还在渐进迁移，
              部分文案暂时仍是中文。
            </p>
          </div>
          <select
            className="settings-input"
            style={{ width: 140 }}
            value={i18n.language}
            onChange={e => setLanguage(e.target.value as 'zh' | 'en')}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">提交</p>

        <div className="settings-row">
          <div>
            <p className="settings-row-label">为提交签名（GPG / SSH）</p>
            <p className="settings-row-desc">
              开启后所有"保存进度"会以 <code>git commit -S</code> 提交，依赖你的
              <code> user.signingkey</code> / <code>gpg.format</code> 等本地 git 配置。
            </p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={gpgSign}
              onChange={e => setGpgSign(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">集成</p>

        <button className="settings-nav-row" onClick={onOpenAI} type="button">
          <div className="settings-nav-icon">
            <i className="ti ti-sparkles" />
          </div>
          <div className="settings-nav-text">
            <p className="settings-row-label">AI 服务商</p>
            <p className="settings-row-desc">
              {aiConfigured
                ? `当前：${providerLabel}`
                : '配置 Claude / OpenAI / DeepSeek / Kimi'}
            </p>
          </div>
          <div className="settings-nav-status">
            <span className={`settings-status-dot ${aiConfigured ? 'ok' : 'off'}`} />
            <i className="ti ti-chevron-right" />
          </div>
        </button>

        <button className="settings-nav-row" onClick={onOpenRemotes} type="button">
          <div className="settings-nav-icon">
            <i className="ti ti-cloud" />
          </div>
          <div className="settings-nav-text">
            <p className="settings-row-label">远程仓库</p>
            <p className="settings-row-desc">添加 / 重命名 / 修改 URL / 删除 remote</p>
          </div>
          <div className="settings-nav-status">
            <i className="ti ti-chevron-right" />
          </div>
        </button>

        <button className="settings-nav-row" onClick={onOpenLfs} type="button">
          <div className="settings-nav-icon">
            <i className="ti ti-binary" />
          </div>
          <div className="settings-nav-text">
            <p className="settings-row-label">Git LFS · 大文件</p>
            <p className="settings-row-desc">追踪二进制 / 设计稿 / 模型权重等大文件</p>
          </div>
          <div className="settings-nav-status">
            <i className="ti ti-chevron-right" />
          </div>
        </button>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">数据</p>

        <div className="settings-row">
          <div>
            <p className="settings-row-label">导入 / 导出设置</p>
            <p className="settings-row-desc">
              把 AI Key、主题、偏好等本机配置打包成 JSON。换机器恢复时用导入。
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={handleExportSettings}>
              <i className="ti ti-file-export" />
              导出
            </button>
            <button className="btn-secondary" onClick={handleImportSettings}>
              <i className="ti ti-file-import" />
              导入
            </button>
          </div>
        </div>

        <button className="settings-nav-row" onClick={onOpenShortcuts} type="button">
          <div className="settings-nav-icon">
            <i className="ti ti-keyboard" />
          </div>
          <div className="settings-nav-text">
            <p className="settings-row-label">键盘快捷键</p>
            <p className="settings-row-desc">列出所有快捷键 · 直接按 <kbd>?</kbd> 也能弹</p>
          </div>
          <div className="settings-nav-status">
            <i className="ti ti-chevron-right" />
          </div>
        </button>

        <button className="settings-nav-row" onClick={onOpenAbout} type="button">
          <div className="settings-nav-icon">
            <i className="ti ti-info-circle" />
          </div>
          <div className="settings-nav-text">
            <p className="settings-row-label">关于 Versa</p>
            <p className="settings-row-desc">版本 / 诊断信息 / 复制给开发者</p>
          </div>
          <div className="settings-nav-status">
            <i className="ti ti-chevron-right" />
          </div>
        </button>
      </div>
    </div>
  )
}

// ── Settings import / export ──────────────────────────────────────────────

/** All localStorage keys we own (prefix `versa:`). Collected at runtime so it
 *  reflects whatever's been written, including future keys. */
function collectSettingsBag(): Record<string, string> {
  const bag: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('versa:')) {
      const v = localStorage.getItem(k)
      if (v !== null) bag[k] = v
    }
  }
  return bag
}

async function handleExportSettings() {
  const bag = collectSettingsBag()
  const json = JSON.stringify({ versa: 'settings-export', exportedAt: new Date().toISOString(), data: bag }, null, 2)
  // Use the browser save flow — Tauri's webview honors download events.
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `versa-settings-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function handleImportSettings() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const bag: unknown = parsed?.data
      if (!bag || typeof bag !== 'object') throw new Error('文件结构不对：缺少 data 字段')
      const entries = Object.entries(bag as Record<string, unknown>)
      const safe = entries.filter(([k, v]) => k.startsWith('versa:') && typeof v === 'string')
      if (safe.length === 0) throw new Error('文件里没有 versa:* 的设置键')
      const ok = window.confirm(`即将覆盖 ${safe.length} 项本机设置。继续？`)
      if (!ok) return
      for (const [k, v] of safe) localStorage.setItem(k, v as string)
      window.location.reload()
    } catch (e) {
      useStore.getState().showToast(`导入失败：${String(e)}`, 'error')
    }
  }
  input.click()
}

// ── Remotes sub-page ──────────────────────────────────────────────────────

function RemotesSettings({ onBack }: { onBack: () => void }) {
  const { listRemotes, addRemote, removeRemote, renameRemote, setRemoteUrl, showToast } = useStore()
  const [remotes, setRemotes] = useState<RemoteInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editName, setEditName] = useState('')

  const refresh = async () => {
    setLoading(true)
    try { setRemotes(await listRemotes()) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const handleAdd = async () => {
    const n = newName.trim()
    const u = newUrl.trim()
    if (!n || !u) return
    try {
      await addRemote(n, u)
      setNewName(''); setNewUrl('')
      await refresh()
    } catch (e) { showToast(String(e), 'error') }
  }

  const handleSave = async (origName: string) => {
    try {
      if (editName.trim() && editName.trim() !== origName) {
        await renameRemote(origName, editName.trim())
      }
      const target = editName.trim() || origName
      if (editUrl.trim()) {
        await setRemoteUrl(target, editUrl.trim())
      }
      setEditing(null)
      await refresh()
    } catch (e) { showToast(String(e), 'error') }
  }

  const handleDelete = async (name: string) => {
    try { await removeRemote(name); await refresh() }
    catch (e) { showToast(String(e), 'error') }
  }

  return (
    <div className="settings-view">
      <div className="settings-subpage-header">
        <button className="settings-back-btn" onClick={onBack} type="button" aria-label="返回">
          <i className="ti ti-chevron-left" />
          <span>设置</span>
        </button>
        <h2 className="settings-page-title settings-subpage-title">远程仓库</h2>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">已配置</p>
        {loading ? (
          <p className="rs-empty">加载中…</p>
        ) : remotes.length === 0 ? (
          <p className="rs-empty">还没有添加 remote</p>
        ) : (
          <div className="remote-list">
            {remotes.map(r => (
              <div key={r.name} className="remote-row">
                {editing === r.name ? (
                  <>
                    <input
                      className="settings-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder={r.name}
                      style={{ width: 140 }}
                    />
                    <input
                      className="settings-input"
                      value={editUrl}
                      onChange={e => setEditUrl(e.target.value)}
                      placeholder={r.url}
                    />
                    <button className="ct-btn" onClick={() => handleSave(r.name)}>保存</button>
                    <button className="ct-btn" onClick={() => setEditing(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <span className="remote-name">{r.name}</span>
                    <span className="remote-url">{r.url}</span>
                    <button
                      className="ct-btn"
                      onClick={() => { setEditing(r.name); setEditName(r.name); setEditUrl(r.url) }}
                    >
                      编辑
                    </button>
                    <button className="ct-btn danger" onClick={() => handleDelete(r.name)}>删除</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-section">
        <p className="settings-section-title">新增</p>
        <div className="remote-row">
          <input
            className="settings-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="名称（如 origin / upstream）"
            style={{ width: 180 }}
          />
          <input
            className="settings-input"
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="URL（git@github.com:user/repo.git 或 https://…）"
          />
          <button
            className="ct-btn"
            onClick={handleAdd}
            disabled={!newName.trim() || !newUrl.trim()}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AI sub-page ───────────────────────────────────────────────────────────

function AISettings({ onBack }: { onBack: () => void }) {
  const { aiConfig, setAIConfig } = useStore()
  const [showKey, setShowKey] = useState(false)
  const meta = PROVIDER_MAP.get(aiConfig.provider) ?? PROVIDERS[0]
  const modelPlaceholder = meta.defaultModel || '必须填写'

  return (
    <div className="settings-view">
      <div className="settings-subpage-header">
        <button className="settings-back-btn" onClick={onBack} type="button" aria-label="返回">
          <i className="ti ti-chevron-left" />
          <span>设置</span>
        </button>
        <h2 className="settings-page-title settings-subpage-title">AI 服务商</h2>
      </div>

      <p className="settings-subpage-hint">
        AI 用于"生成 commit message""解释提交""分析冲突"等。
        API Key 只保存在本机的 localStorage，不会上传到 Versa 的服务器。
      </p>

      <div className="settings-section">
        <p className="settings-section-title">服务商</p>
        <div className="provider-grid">
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              className={`provider-card ${aiConfig.provider === p.value ? 'selected' : ''}`}
              onClick={() => setAIConfig({ provider: p.value })}
              aria-pressed={aiConfig.provider === p.value}
              type="button"
            >
              <span className="provider-card-label">{p.label}</span>
              <span className="provider-card-hint">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title">凭证</p>

        <div className="settings-row settings-row-stack">
          <div>
            <p className="settings-row-label">API Key</p>
            <p className="settings-row-desc">从服务商控制台复制过来</p>
          </div>
          <div className="settings-input-wrap">
            <input
              className="settings-input"
              type={showKey ? 'text' : 'password'}
              value={aiConfig.apiKey}
              onChange={e => setAIConfig({ apiKey: e.target.value })}
              placeholder={meta.keyPlaceholder}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className="settings-input-toggle"
              onClick={() => setShowKey(v => !v)}
              title={showKey ? '隐藏' : '显示'}
              type="button"
            >
              <i className={`ti ${showKey ? 'ti-eye-off' : 'ti-eye'}`} />
            </button>
          </div>
        </div>

        <div className="settings-row settings-row-stack">
          <div>
            <p className="settings-row-label">模型</p>
            <p className="settings-row-desc">
              留空使用默认（{meta.defaultModel || '本服务商无默认，必须填写'}）
            </p>
          </div>
          <input
            className="settings-input"
            type="text"
            value={aiConfig.model}
            onChange={e => setAIConfig({ model: e.target.value })}
            placeholder={modelPlaceholder}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {!meta.hasPresetBaseUrl && (
          <div className="settings-row settings-row-stack">
            <div>
              <p className="settings-row-label">Base URL</p>
              <p className="settings-row-desc">例如 https://your-host/v1（需要兼容 OpenAI Chat Completions）</p>
            </div>
            <input
              className="settings-input"
              type="text"
              value={aiConfig.baseUrl}
              onChange={e => setAIConfig({ baseUrl: e.target.value })}
              placeholder="https://..../v1"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── LFS sub-page ──────────────────────────────────────────────────────────

function LfsSettings({ onBack }: { onBack: () => void }) {
  const {
    lfsCheck, lfsListPatterns, lfsTrack, lfsUntrack,
    lfsLsFiles, lfsPull, lfsFetch, showToast,
  } = useStore()
  const [status, setStatus] = useState<LfsStatus | null>(null)
  const [patterns, setPatterns] = useState<LfsPattern[]>([])
  const [files, setFiles] = useState<LfsFile[]>([])
  const [loading, setLoading] = useState(true)
  const [newPattern, setNewPattern] = useState('')
  const [working, setWorking] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const s = await lfsCheck()
      setStatus(s)
      if (s.installed) {
        const [p, f] = await Promise.all([lfsListPatterns(), lfsLsFiles()])
        setPatterns(p)
        setFiles(f)
      }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { refresh() }, [])

  const handleTrack = async () => {
    const p = newPattern.trim()
    if (!p) return
    setWorking(true)
    try { await lfsTrack(p); setNewPattern(''); await refresh() }
    catch (e) { showToast(String(e), 'error') }
    finally { setWorking(false) }
  }
  const handleUntrack = async (p: string) => {
    setWorking(true)
    try { await lfsUntrack(p); await refresh() }
    catch (e) { showToast(String(e), 'error') }
    finally { setWorking(false) }
  }

  return (
    <div className="settings-view">
      <div className="settings-subpage-header">
        <button className="settings-back-btn" onClick={onBack} type="button" aria-label="返回">
          <i className="ti ti-chevron-left" />
          <span>设置</span>
        </button>
        <h2 className="settings-page-title settings-subpage-title">Git LFS</h2>
      </div>

      {loading ? (
        <p className="rs-empty">检查中…</p>
      ) : !status?.installed ? (
        <p className="settings-subpage-hint">
          <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} />
          <b>没检测到 <code>git-lfs</code> 命令</b>。Versa 通过 shell 调用 git-lfs，所以你需要先装上：
          <br /><br />
          • macOS：<code>brew install git-lfs</code>
          <br />
          • Ubuntu / Debian：<code>sudo apt install git-lfs</code>
          <br />
          • Windows：从 <code>https://git-lfs.com</code> 下载安装包
          <br /><br />
          装完后执行一次 <code>git lfs install</code>（全局只用一次），然后回这一页刷新即可。
        </p>
      ) : (
        <>
          <p className="settings-subpage-hint">
            <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
            已安装 <code>{status.version}</code>。LFS 用 pointer 把大文件挪到独立服务端，
            常见用法：把 <code>*.psd</code>、<code>*.bin</code>、<code>*.zip</code> 等模式加进来，
            git 会自动把这些文件存到 LFS 而不是 git 历史里。
          </p>

          <div className="settings-section">
            <p className="settings-section-title">已追踪模式 · {patterns.length}</p>
            {patterns.length === 0 ? (
              <p className="rs-empty">还没有任何追踪模式</p>
            ) : (
              <div className="remote-list">
                {patterns.map(p => (
                  <div key={p.pattern} className="remote-row">
                    <span className="remote-name" style={{ width: '100%' }}>{p.pattern}</span>
                    <button
                      className="ct-btn danger"
                      disabled={working}
                      onClick={() => handleUntrack(p.pattern)}
                    >
                      取消追踪
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="remote-row" style={{ marginTop: 8 }}>
              <input
                className="settings-input"
                value={newPattern}
                onChange={e => setNewPattern(e.target.value)}
                placeholder='模式（如 "*.psd"、"assets/**/*.bin"）'
              />
              <button
                className="ct-btn"
                onClick={handleTrack}
                disabled={working || !newPattern.trim()}
              >
                添加追踪
              </button>
            </div>
          </div>

          <div className="settings-section">
            <p className="settings-section-title">LFS 文件 · {files.length}</p>
            {files.length === 0 ? (
              <p className="rs-empty">这个仓库里没有 LFS 文件</p>
            ) : (
              <div className="lfs-file-list">
                {files.slice(0, 200).map(f => (
                  <div key={f.path} className="lfs-file-row">
                    <span
                      className={`lfs-presence ${f.presence === '*' ? 'present' : 'pointer'}`}
                      title={f.presence === '*' ? '已下载到本地' : '只是 pointer，未下载内容'}
                    >
                      {f.presence === '*' ? '已下载' : '仅指针'}
                    </span>
                    <span className="lfs-file-path">{f.path}</span>
                    <span className="lfs-file-oid">{f.oid.slice(0, 12)}</span>
                  </div>
                ))}
                {files.length > 200 && (
                  <p className="rs-empty" style={{ paddingTop: 6 }}>
                    （只显示前 200 个，共 {files.length} 个）
                  </p>
                )}
              </div>
            )}
            <div className="remote-row" style={{ marginTop: 8 }}>
              <button
                className="ct-btn"
                disabled={working}
                onClick={async () => {
                  setWorking(true)
                  try { await lfsPull() } catch (e) { showToast(String(e), 'error') }
                  finally { setWorking(false); await refresh() }
                }}
              >
                <i className="ti ti-download" />
                拉取当前分支的 LFS
              </button>
              <button
                className="ct-btn"
                disabled={working}
                onClick={async () => {
                  setWorking(true)
                  try { await lfsFetch() } catch (e) { showToast(String(e), 'error') }
                  finally { setWorking(false); await refresh() }
                }}
              >
                <i className="ti ti-archive" />
                下载所有 ref 的 LFS（fetch --all）
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
