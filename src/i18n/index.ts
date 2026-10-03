import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import zhCN from './zh-CN.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof en;
    };
  }
}

declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof en;
    };
  }
}

/**
 * 语言选择：系统语言以 zh 开头（zh-CN、zh-TW、zh-HK 等）时使用简体中文，
 * 其他一律使用英文（默认）。纯客户端应用，直接读取 navigator.language。
 */
function detectLanguage(): 'zh-CN' | 'en' {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    if (navigator.language.toLowerCase().startsWith('zh')) {
      return 'zh-CN';
    }
  }
  return 'en';
}

const language = detectLanguage();

if (typeof document !== 'undefined') {
  document.documentElement.lang = language;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: language,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
