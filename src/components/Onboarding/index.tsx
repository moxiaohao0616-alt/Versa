import { useState } from 'react'

const STORAGE_KEY = 'versa:onboarded'

/** True if the onboarding flow should run on this launch (never seen before). */
export function shouldShowOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== '1'
}

export function markOnboarded() {
  localStorage.setItem(STORAGE_KEY, '1')
}

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: '欢迎使用 Versa',
    body: (
      <>
        <p>Git 不再是命令行专属——Versa 把它做成全栈工程师每天都能直觉操作的工具。</p>
        <p style={{ marginTop: 10, opacity: 0.75 }}>
          下面几步带你过一遍核心功能，可以随时按右下角"跳过"。
        </p>
      </>
    ),
  },
  {
    title: '把仓库拖进来',
    body: (
      <>
        <p>三种方式打开仓库：</p>
        <ul style={{ paddingLeft: 18, lineHeight: 1.8 }}>
          <li>欢迎页点"打开仓库"</li>
          <li>把文件夹拖到窗口里</li>
          <li>顶上 Tab 加号继续加更多仓库（多 Tab 管理）</li>
        </ul>
      </>
    ),
  },
  {
    title: '日常工作流',
    body: (
      <>
        <p>左侧栏负责"做提交"：暂存文件 → 写说明 → 保存进度（commit）→ 推送到云。</p>
        <p>中间是 diff，按 <kbd>⌘F</kbd> 可以在里面搜文本，按 <kbd>Alt↑↓</kbd> 跳上下一处改动。</p>
        <p style={{ opacity: 0.75 }}>所有真实的 git 名词都翻译成了人话："保存进度"、"这版好/坏"、"回退到这版"等。</p>
      </>
    ),
  },
  {
    title: '配 AI 之后更顺手',
    body: (
      <>
        <p>到 <b>设置 → AI 服务商</b> 填一个 API Key，就能：</p>
        <ul style={{ paddingLeft: 18, lineHeight: 1.8 }}>
          <li>自动生成 commit message</li>
          <li>解释某次提交"到底改了啥"</li>
          <li>合并前预警冲突风险</li>
          <li>bisect 推荐起点</li>
        </ul>
        <p style={{ opacity: 0.75, marginTop: 6 }}>支持 Anthropic / OpenAI / DeepSeek / Kimi / 任意 OpenAI 兼容。</p>
      </>
    ),
  },
  {
    title: '记得这些就够了',
    body: (
      <>
        <p>实在卡住按 <kbd>?</kbd> 看全部快捷键。</p>
        <p>误操作了？左 Sidebar 的 <i className="ti ti-history" /> "时光机" 能把仓库回退到任何一步。</p>
        <p style={{ opacity: 0.75, marginTop: 6 }}>祝你少进 Terminal 一点 👋</p>
      </>
    ),
  },
]

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1

  const finish = () => {
    markOnboarded()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={finish}>
      <div className="modal onboarding-modal" onClick={e => e.stopPropagation()}>
        <div className="onboarding-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>
        <div className="modal-title">{STEPS[step].title}</div>
        <div className="onboarding-body">{STEPS[step].body}</div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={finish}>跳过</button>
          {step > 0 && (
            <button className="btn-secondary" onClick={() => setStep(s => s - 1)}>上一步</button>
          )}
          <button
            className="btn-primary"
            onClick={() => (last ? finish() : setStep(s => s + 1))}
          >
            {last ? '开始用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
