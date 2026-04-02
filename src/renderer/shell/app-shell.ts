import type { AppState, AppStore } from '../store/app-store'
import { translateApp } from '../../shared/localization'
import { mountSettingsPanel } from './settings-panel'

interface AppShell {
  destroy: () => void
}

function getPathBasename(path: string | null): string | null {
  if (!path) return null
  const segments = path.split(/[/\\]/)
  return segments[segments.length - 1] || null
}

function getTitlebarContext(state: AppState): string {
  return getPathBasename(state.activeFilePath) || getPathBasename(state.workspaceRoot) || 'Mako'
}

export function mountAppShell(store: AppStore): AppShell {
  const app = document.getElementById('app')
  const sidebar = document.getElementById('sidebar')
  const titlebarContext = document.getElementById('window-title-label')

  if (!app || !sidebar || !titlebarContext) {
    throw new Error('App shell elements are missing')
  }

  const render = (state: AppState): void => {
    const isCollapsed = state.sidebarCollapsed
    app.dataset.sidebarCollapsed = String(isCollapsed)
    sidebar.setAttribute('aria-hidden', String(isCollapsed))
    sidebar.setAttribute('aria-label', translateApp(state.language, 'workspace.sidebarAriaLabel'))
    document.documentElement.lang = state.language
    titlebarContext.textContent = getTitlebarContext(state)
  }

  const unsubscribe = store.subscribe((state) => render(state))
  const settingsPanel = mountSettingsPanel(store)
  render(store.getState())

  return {
    destroy: () => {
      unsubscribe()
      settingsPanel.destroy()
    }
  }
}
