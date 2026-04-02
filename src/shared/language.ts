export const supportedAppLanguages = ['zh-CN', 'en'] as const

export type AppLanguage = (typeof supportedAppLanguages)[number]

export const defaultAppLanguage: AppLanguage = 'zh-CN'

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === 'zh-CN' || value === 'en'
}

export function normalizeAppLanguage(value: string | null | undefined): AppLanguage {
  return isAppLanguage(value) ? value : defaultAppLanguage
}
