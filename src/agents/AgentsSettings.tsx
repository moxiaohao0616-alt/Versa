import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore, type AgentConfig } from '../lib/agents'

/**
 * Settings → AI Agents sub-page. Lists configured CLI agents (Claude Code,
 * Codex, custom) and lets the user add / edit / reset them. The list is
 * persisted globally per machine (not per-repo) via localStorage in
 * [`useAgentStore`].
 */
export function AgentsSettings({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const { agents, add, update, remove, resetBuiltin } = useAgentStore()
  const [editing, setEditing] = useState<AgentConfig | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="settings-view">
      <div className="settings-subpage-header">
        <button className="settings-back-btn" onClick={onBack} type="button" aria-label="Back">
          <i className="ti ti-chevron-left" />
          <span>Settings</span>
        </button>
        <h2 className="settings-page-title settings-subpage-title">{t('settings.agents_title')}</h2>
      </div>

      <p className="settings-subpage-hint">{t('settings.agents_hint')}</p>

      <div className="settings-section">
        <p className="settings-section-title">{t('settings.agents_configured')}</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              onEdit={() => setEditing(a)}
              onDelete={() => {
                if (confirm(t('settings.agents_delete_confirm', { name: a.name }))) {
                  remove(a.id)
                }
              }}
              onReset={() => {
                if (confirm(t('settings.agents_reset_confirm', { name: a.name }))) {
                  resetBuiltin(a.id)
                }
              }}
            />
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setCreating(true)}
          >
            <i className="ti ti-plus" style={{ marginRight: 4 }} />
            {t('settings.agents_add')}
          </button>
        </div>
      </div>

      {(editing || creating) && (
        <AgentEditModal
          agent={editing}
          onCancel={() => {
            setEditing(null)
            setCreating(false)
          }}
          onSave={(cfg) => {
            if (editing) {
              update(editing.id, cfg)
            } else {
              add(cfg)
            }
            setEditing(null)
            setCreating(false)
          }}
        />
      )}
    </div>
  )
}

// ─── single row ─────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  onEdit,
  onDelete,
  onReset,
}: {
  agent: AgentConfig
  onEdit: () => void
  onDelete: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 0',
        borderBottom: '1px solid var(--border, #eee)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>
          {agent.name}
          {agent.builtin && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                padding: '1px 5px',
                borderRadius: 3,
                background: 'var(--bg2, #eee)',
                color: 'var(--text-muted, #666)',
              }}
            >
              {t('settings.agents_builtin_tag')}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted, #888)',
            fontFamily: 'var(--font-mono, monospace)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {agent.command} {agent.extraArgs}
        </div>
      </div>
      <button type="button" className="btn-secondary" onClick={onEdit}>
        {t('common.edit', { defaultValue: 'Edit' })}
      </button>
      {agent.builtin ? (
        <button type="button" className="btn-secondary" onClick={onReset} title={t('settings.agents_reset')}>
          <i className="ti ti-rotate" />
        </button>
      ) : (
        <button type="button" className="btn-secondary danger" onClick={onDelete}>
          <i className="ti ti-trash" />
        </button>
      )}
    </li>
  )
}

// ─── add/edit modal ─────────────────────────────────────────────────────────

function AgentEditModal({
  agent,
  onCancel,
  onSave,
}: {
  /** null = new, defined = edit existing */
  agent: AgentConfig | null
  onCancel: () => void
  onSave: (cfg: Omit<AgentConfig, 'id' | 'builtin'>) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(agent?.name ?? '')
  const [command, setCommand] = useState(agent?.command ?? '')
  const [extraArgs, setExtraArgs] = useState(agent?.extraArgs ?? '')

  const valid = name.trim() && command.trim()

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <i className="ti ti-robot" style={{ marginRight: 6 }} />
          {agent
            ? t('settings.agents_edit_title', { name: agent.name })
            : t('settings.agents_add_title')}
        </div>
        <div style={{ padding: '12px 18px 18px' }}>
          <Field label={t('settings.agents_field_name')}>
            <input
              className="settings-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Claude Code"
              autoFocus
            />
          </Field>
          <Field
            label={t('settings.agents_field_command')}
            hint={t('settings.agents_field_command_hint')}
          >
            <input
              className="settings-input"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="claude"
              style={{ fontFamily: 'var(--font-mono, monospace)' }}
            />
          </Field>
          <Field
            label={t('settings.agents_field_args')}
            hint={t('settings.agents_field_args_hint')}
          >
            <input
              className="settings-input"
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              placeholder={t('settings.agents_field_args_placeholder')}
              style={{ fontFamily: 'var(--font-mono, monospace)' }}
            />
          </Field>

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 16,
              borderTop: '1px solid var(--border, #eee)',
              paddingTop: 12,
            }}
          >
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!valid}
              onClick={() =>
                onSave({
                  name: name.trim(),
                  command: command.trim(),
                  extraArgs: extraArgs.trim(),
                })
              }
            >
              {t('common.save', { defaultValue: 'Save' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
        {label}
      </label>
      {children}
      {hint && (
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '4px 0 0' }}>
          {hint}
        </p>
      )}
    </div>
  )
}
