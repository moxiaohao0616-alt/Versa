import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { zh } from './zh'
import { en } from './en'

/** Versa is shipping i18n incrementally. Only strings that surfaced as
 *  important so far are translated — most components still hardcode Chinese.
 *  As we touch them, migrate them to use `t('...')` and add the key to both
 *  `zh.ts` and `en.ts`.
 *
 *  We default to zh-CN (the original language) and keep that as the fallback
 *  so unmigrated strings keep working when the user switches to English. */
const SAVED_LANG_KEY = 'versa:lang'

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: localStorage.getItem(SAVED_LANG_KEY) ?? 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

export function setLanguage(lng: 'zh' | 'en') {
  localStorage.setItem(SAVED_LANG_KEY, lng)
  i18n.changeLanguage(lng)
}

export default i18n
