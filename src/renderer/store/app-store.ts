import type { DocThemeName, UIThemeName } from '../../shared/desktop'
import {
  defaultAppLanguage,
  isAppLanguage,
  type AppLanguage
} from '../../shared/language'

const sidebarCollapsedStorageKey = 'colamd-sidebar-collapsed'
const workspaceRootStorageKey = 'colamd-workspace-root'
const workspaceRootSourceStorageKey = 'colamd-workspace-root-source'
const expandedDirsStorageKey = 'colamd-expanded-dirs'
const uiThemeStorageKey = 'colamd-ui-theme'
const docThemeStorageKey = 'colamd-doc-theme'
const customDocThemeStorageKey = 'colamd-custom-doc-theme-css'
const editorFontFamilyStorageKey = 'colamd-editor-font-family'
const editorFontSizeStorageKey = 'colamd-editor-font-size'
const sidebarTabStorageKey = 'colamd-sidebar-tab'
const languageStorageKey = 'colamd-language'

const legacyThemeStorageKey = 'colamd-theme'
const legacyCustomThemeStorageKey = 'colamd-custom-theme-css'

export type EditorFontFamilyName = 'system' | 'serif' | 'mono'
export type SidebarTabName = 'files' | 'outline'

export type WorkspaceRootSource = 'explicit' | 'inferred' | null

export interface AppState {
  sidebarCollapsed: boolean
  workspaceRoot: string | null
  workspaceRootSource: WorkspaceRootSource
  activeFilePath: string | null
  expandedDirs: string[]
  language: AppLanguage
  uiTheme: UIThemeName
  docTheme: DocThemeName
  customDocThemeCSS?: string
  editorFontFamily: EditorFontFamilyName
  editorFontSize: number
  sidebarTab: SidebarTabName
  settingsOpen: boolean
}

export type AppStateListener = (state: Readonly<AppState>, previousState: Readonly<AppState>) => void

export interface AppStore {
  getState: () => Readonly<AppState>
  setState: (
    nextState: Partial<AppState> | ((state: Readonly<AppState>) => Partial<AppState>)
  ) => void
  subscribe: (listener: AppStateListener) => () => void
}

const defaultState: AppState = {
  sidebarCollapsed: true,
  workspaceRoot: null,
  workspaceRootSource: null,
  activeFilePath: null,
  expandedDirs: [],
  language: defaultAppLanguage,
  uiTheme: 'light',
  docTheme: 'elegant',
  editorFontFamily: 'system',
  editorFontSize: 16,
  sidebarTab: 'files',
  settingsOpen: false
}

function isUIThemeName(value: string | null): value is UIThemeName {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isDocThemeName(value: string | null): value is DocThemeName {
  return value === 'default' || value === 'elegant' || value === 'newsprint' || value === 'custom'
}

function isEditorFontFamilyName(value: string | null): value is EditorFontFamilyName {
  return value === 'system' || value === 'serif' || value === 'mono'
}

function isSidebarTabName(value: string | null): value is SidebarTabName {
  return value === 'files' || value === 'outline'
}

function parseWorkspaceRootSource(value: string | null): WorkspaceRootSource {
  if (value === 'explicit' || value === 'inferred') {
    return value
  }

  return null
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  return value === 'true'
}

function parseNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function loadLegacyThemeState(): Pick<AppState, 'uiTheme' | 'docTheme' | 'customDocThemeCSS'> {
  const legacyTheme = localStorage.getItem(legacyThemeStorageKey)
  const legacyCustomCSS = localStorage.getItem(legacyCustomThemeStorageKey) ?? undefined

  switch (legacyTheme) {
    case 'light':
      return { uiTheme: 'light', docTheme: 'default' }
    case 'dark':
      return { uiTheme: 'dark', docTheme: 'default' }
    case 'newsprint':
      return { uiTheme: 'light', docTheme: 'newsprint' }
    case 'custom':
      if (legacyCustomCSS) {
        return { uiTheme: 'light', docTheme: 'custom', customDocThemeCSS: legacyCustomCSS }
      }
      return { uiTheme: 'light', docTheme: 'elegant' }
    case 'elegant':
    default:
      return { uiTheme: 'light', docTheme: 'elegant' }
  }
}

export function loadSavedAppState(): AppState {
  const persistedUITheme = localStorage.getItem(uiThemeStorageKey)
  const persistedDocTheme = localStorage.getItem(docThemeStorageKey)
  const hasSplitThemeState = persistedUITheme !== null || persistedDocTheme !== null
  const migratedThemeState = hasSplitThemeState ? null : loadLegacyThemeState()

  const uiTheme = isUIThemeName(persistedUITheme)
    ? persistedUITheme
    : migratedThemeState?.uiTheme ?? defaultState.uiTheme

  const docTheme = isDocThemeName(persistedDocTheme)
    ? persistedDocTheme
    : migratedThemeState?.docTheme ?? defaultState.docTheme

  const customDocThemeCSS =
    localStorage.getItem(customDocThemeStorageKey) ??
    migratedThemeState?.customDocThemeCSS
  const persistedEditorFontFamily = localStorage.getItem(editorFontFamilyStorageKey)
  const persistedLanguage = localStorage.getItem(languageStorageKey)
  const persistedWorkspaceRoot = localStorage.getItem(workspaceRootStorageKey)
  const persistedWorkspaceRootSource = parseWorkspaceRootSource(
    localStorage.getItem(workspaceRootSourceStorageKey)
  )
  const workspaceRootSource = persistedWorkspaceRoot
    ? persistedWorkspaceRootSource ?? 'explicit'
    : null

  return {
    sidebarCollapsed: parseBoolean(
      localStorage.getItem(sidebarCollapsedStorageKey),
      defaultState.sidebarCollapsed
    ),
    workspaceRoot: persistedWorkspaceRoot,
    workspaceRootSource,
    activeFilePath: null,
    expandedDirs: parseStringArray(localStorage.getItem(expandedDirsStorageKey)),
    language: isAppLanguage(persistedLanguage) ? persistedLanguage : defaultState.language,
    uiTheme,
    docTheme: docTheme === 'custom' && !customDocThemeCSS ? 'elegant' : docTheme,
    customDocThemeCSS: customDocThemeCSS ?? undefined,
    editorFontFamily: isEditorFontFamilyName(persistedEditorFontFamily)
      ? persistedEditorFontFamily
      : defaultState.editorFontFamily,
    editorFontSize: parseNumber(
      localStorage.getItem(editorFontSizeStorageKey),
      defaultState.editorFontSize,
      13,
      24
    ),
    sidebarTab: isSidebarTabName(localStorage.getItem(sidebarTabStorageKey))
      ? (localStorage.getItem(sidebarTabStorageKey) as SidebarTabName)
      : defaultState.sidebarTab,
    settingsOpen: false
  }
}

function persistState(state: Readonly<AppState>): void {
  localStorage.setItem(sidebarCollapsedStorageKey, String(state.sidebarCollapsed))

  if (state.workspaceRoot && state.workspaceRootSource === 'explicit') {
    localStorage.setItem(workspaceRootStorageKey, state.workspaceRoot)
    localStorage.setItem(workspaceRootSourceStorageKey, state.workspaceRootSource)
    localStorage.setItem(expandedDirsStorageKey, JSON.stringify(state.expandedDirs))
  } else {
    localStorage.removeItem(workspaceRootStorageKey)
    localStorage.removeItem(workspaceRootSourceStorageKey)
    localStorage.removeItem(expandedDirsStorageKey)
  }

  localStorage.setItem(uiThemeStorageKey, state.uiTheme)
  localStorage.setItem(docThemeStorageKey, state.docTheme)
  localStorage.setItem(editorFontFamilyStorageKey, state.editorFontFamily)
  localStorage.setItem(editorFontSizeStorageKey, String(state.editorFontSize))
  localStorage.setItem(sidebarTabStorageKey, state.sidebarTab)
  localStorage.setItem(languageStorageKey, state.language)

  if (state.customDocThemeCSS) {
    localStorage.setItem(customDocThemeStorageKey, state.customDocThemeCSS)
  } else {
    localStorage.removeItem(customDocThemeStorageKey)
  }
}

function hasStateChanged(nextState: Readonly<AppState>, previousState: Readonly<AppState>): boolean {
  return (
    nextState.sidebarCollapsed !== previousState.sidebarCollapsed ||
    nextState.workspaceRoot !== previousState.workspaceRoot ||
    nextState.workspaceRootSource !== previousState.workspaceRootSource ||
    nextState.activeFilePath !== previousState.activeFilePath ||
    nextState.language !== previousState.language ||
    nextState.uiTheme !== previousState.uiTheme ||
    nextState.docTheme !== previousState.docTheme ||
    nextState.customDocThemeCSS !== previousState.customDocThemeCSS ||
    nextState.editorFontFamily !== previousState.editorFontFamily ||
    nextState.editorFontSize !== previousState.editorFontSize ||
    nextState.sidebarTab !== previousState.sidebarTab ||
    nextState.settingsOpen !== previousState.settingsOpen ||
    nextState.expandedDirs.length !== previousState.expandedDirs.length ||
    nextState.expandedDirs.some((dir, index) => dir !== previousState.expandedDirs[index])
  )
}

export function createAppStore(initialState: AppState = loadSavedAppState()): AppStore {
  let state: AppState = { ...initialState }
  const listeners = new Set<AppStateListener>()

  return {
    getState: () => state,
    setState: (nextState) => {
      const partialState = typeof nextState === 'function' ? nextState(state) : nextState
      const previousState = state
      const resolvedState: AppState = { ...state, ...partialState }

      if (!hasStateChanged(resolvedState, previousState)) {
        return
      }

      state = resolvedState
      persistState(state)

      listeners.forEach((listener) => listener(state, previousState))
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
