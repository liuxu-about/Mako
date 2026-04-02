import type { AppLanguage } from '../shared/language'
import { defaultAppLanguage } from '../shared/language'
import {
  translateApp,
  type TranslationKey,
  type TranslationValues
} from '../shared/localization'

let currentRendererLanguage: AppLanguage = defaultAppLanguage
const listeners = new Set<(language: AppLanguage) => void>()

export function getCurrentRendererLanguage(): AppLanguage {
  return currentRendererLanguage
}

export function setCurrentRendererLanguage(language: AppLanguage): void {
  if (currentRendererLanguage === language) {
    return
  }

  currentRendererLanguage = language
  listeners.forEach((listener) => listener(language))
}

export function subscribeRendererLanguageChange(
  listener: (language: AppLanguage) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function translateCurrentRenderer(
  key: TranslationKey,
  values: TranslationValues = {}
): string {
  return translateApp(currentRendererLanguage, key, values)
}
