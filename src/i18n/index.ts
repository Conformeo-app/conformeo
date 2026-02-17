import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import fr from './fr.json';

const FALLBACK_LANGUAGE = 'fr';

function resolveInitialLanguage(): string {
  try {
    const locale = Localization.getLocales?.()?.[0];
    const code = locale?.languageCode?.toLowerCase();
    if (code === 'fr') {
      return 'fr';
    }
  } catch {
    // ignore
  }

  // MVP: FR par défaut (Conforméo France). On pourra ajouter EN plus tard.
  return FALLBACK_LANGUAGE;
}

const initialLanguage = resolveInitialLanguage();

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: initialLanguage,
  fallbackLng: FALLBACK_LANGUAGE,
  resources: {
    fr: { translation: fr }
  },
  interpolation: {
    escapeValue: false
  }
});

export { i18n };

export function t(key: string, options?: Record<string, unknown>) {
  return i18n.t(key, options as any);
}

