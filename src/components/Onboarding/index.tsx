import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'versa:onboarded'

export function shouldShowOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== '1'
}

export function markOnboarded() {
  localStorage.setItem(STORAGE_KEY, '1')
}

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: t('onboarding.step1_title'),
      body: (
        <>
          <p>{t('onboarding.step1_body_1')}</p>
          <p style={{ marginTop: 10, opacity: 0.75 }}>{t('onboarding.step1_body_2')}</p>
        </>
      ),
    },
    {
      title: t('onboarding.step2_title'),
      body: (
        <>
          <p>{t('onboarding.step2_body_intro')}</p>
          <ul style={{ paddingLeft: 18, lineHeight: 1.8 }}>
            <li>{t('onboarding.step2_item1')}</li>
            <li>{t('onboarding.step2_item2')}</li>
            <li>{t('onboarding.step2_item3')}</li>
          </ul>
        </>
      ),
    },
    {
      title: t('onboarding.step3_title'),
      body: (
        <>
          <p>{t('onboarding.step3_body_1')}</p>
          <p>{t('onboarding.step3_body_2')}</p>
          <p style={{ opacity: 0.75 }}>{t('onboarding.step3_body_3')}</p>
        </>
      ),
    },
    {
      title: t('onboarding.step4_title'),
      body: (
        <>
          <p>{t('onboarding.step4_body_intro')}</p>
          <ul style={{ paddingLeft: 18, lineHeight: 1.8 }}>
            <li>{t('onboarding.step4_item1')}</li>
            <li>{t('onboarding.step4_item2')}</li>
            <li>{t('onboarding.step4_item3')}</li>
            <li>{t('onboarding.step4_item4')}</li>
          </ul>
          <p style={{ opacity: 0.75, marginTop: 6 }}>{t('onboarding.step4_providers')}</p>
        </>
      ),
    },
    {
      title: t('onboarding.step5_title'),
      body: (
        <>
          <p>{t('onboarding.step5_body_1')}</p>
          <p>{t('onboarding.step5_body_2')}</p>
          <p style={{ opacity: 0.75, marginTop: 6 }}>{t('onboarding.step5_body_3')}</p>
        </>
      ),
    },
  ]

  const last = step === steps.length - 1
  const finish = () => {
    markOnboarded()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={finish}>
      <div className="modal onboarding-modal" onClick={e => e.stopPropagation()}>
        <div className="onboarding-progress">
          {steps.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>
        <div className="modal-title">{steps[step].title}</div>
        <div className="onboarding-body">{steps[step].body}</div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={finish}>{t('onboarding.skip')}</button>
          {step > 0 && (
            <button className="btn-secondary" onClick={() => setStep(s => s - 1)}>{t('common.prev')}</button>
          )}
          <button
            className="btn-primary"
            onClick={() => (last ? finish() : setStep(s => s + 1))}
          >
            {last ? t('onboarding.finish') : t('common.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
