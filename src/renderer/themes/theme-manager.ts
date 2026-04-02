import type { DocThemeName, UIThemeName } from '../../shared/desktop'
import type { AppState, EditorFontFamilyName } from '../store/app-store'

const uiThemeClasses: Record<'light' | 'dark', string> = {
  light: 'ui-theme-light',
  dark: 'ui-theme-dark'
}

const docThemeClasses: Record<DocThemeName, string> = {
  default: 'doc-theme-default',
  elegant: 'doc-theme-elegant',
  newsprint: 'doc-theme-newsprint',
  custom: 'doc-theme-custom'
}

const legacyThemeClasses = ['theme-light', 'theme-dark', 'theme-elegant', 'theme-newsprint', 'theme-custom']

let customStyleEl: HTMLStyleElement | null = null

export type ThemeState = Pick<
  AppState,
  'uiTheme' | 'docTheme' | 'customDocThemeCSS' | 'editorFontFamily' | 'editorFontSize'
>

const editorFontFamilies: Record<EditorFontFamilyName, string> = {
  system: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`,
  serif: `Iowan Old Style, Georgia, 'Times New Roman', serif`,
  mono: `'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace`
}

function getSystemThemeQuery(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

function resolveUITheme(name: UIThemeName): 'light' | 'dark' {
  if (name === 'system') {
    return getSystemThemeQuery().matches ? 'dark' : 'light'
  }

  return name
}

function resolveDocTheme(name: DocThemeName, customDocThemeCSS?: string): DocThemeName {
  if (name === 'custom' && !customDocThemeCSS) {
    return 'default'
  }

  return name
}

function clearCustomStyle(): void {
  if (customStyleEl) {
    customStyleEl.remove()
    customStyleEl = null
  }
}

export function applyThemeState(themeState: ThemeState): void {
  const body = document.body
  const resolvedUITheme = resolveUITheme(themeState.uiTheme)
  const resolvedDocTheme = resolveDocTheme(themeState.docTheme, themeState.customDocThemeCSS)

  Object.values(uiThemeClasses).forEach((className) => body.classList.remove(className))
  Object.values(docThemeClasses).forEach((className) => body.classList.remove(className))
  legacyThemeClasses.forEach((className) => body.classList.remove(className))

  clearCustomStyle()

  body.classList.add(uiThemeClasses[resolvedUITheme])
  body.classList.add(docThemeClasses[resolvedDocTheme])
  body.classList.add(`theme-${resolvedUITheme}`)
  body.dataset.uiTheme = themeState.uiTheme
  body.dataset.docTheme = resolvedDocTheme
  body.dataset.editorFontFamily = themeState.editorFontFamily
  body.style.setProperty('--editor-font-family', editorFontFamilies[themeState.editorFontFamily])
  body.style.setProperty('--editor-font-size', `${themeState.editorFontSize}px`)
  body.style.setProperty('--source-font-size', `${Math.max(themeState.editorFontSize - 1, 13)}px`)

  if (resolvedDocTheme === 'elegant' || resolvedDocTheme === 'newsprint' || resolvedDocTheme === 'custom') {
    body.classList.add(`theme-${resolvedDocTheme}`)
  }

  if (resolvedDocTheme === 'custom' && themeState.customDocThemeCSS) {
    customStyleEl = document.createElement('style')
    customStyleEl.textContent = themeState.customDocThemeCSS
    document.head.appendChild(customStyleEl)
  }
}

export function observeSystemThemeChanges(onChange: () => void): () => void {
  const mediaQuery = getSystemThemeQuery()
  const listener = (): void => onChange()

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }

  mediaQuery.addListener(listener)
  return () => mediaQuery.removeListener(listener)
}

export function isThemeStateChanged(nextState: ThemeState, prevState: ThemeState): boolean {
  return (
    nextState.uiTheme !== prevState.uiTheme ||
    nextState.docTheme !== prevState.docTheme ||
    nextState.customDocThemeCSS !== prevState.customDocThemeCSS ||
    nextState.editorFontFamily !== prevState.editorFontFamily ||
    nextState.editorFontSize !== prevState.editorFontSize
  )
}
