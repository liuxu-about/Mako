import type { DesktopAPI } from '../../shared/desktop'
import { createTauriDesktopAPI } from './tauri-adapter'

let cachedDesktopAPI: DesktopAPI | null = null

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function getDesktopAPI(): DesktopAPI {
  if (cachedDesktopAPI) {
    return cachedDesktopAPI
  }

  if (!isTauriRuntime()) {
    throw new Error('Mako now only supports the Tauri runtime')
  }

  cachedDesktopAPI = createTauriDesktopAPI()
  return cachedDesktopAPI
}
