import type { AppLanguage } from './language'

export type FileActionResult = 'success' | 'cancelled' | 'error'
export type UIThemeName = 'system' | 'light' | 'dark'
export type DocThemeName = 'default' | 'elegant' | 'newsprint' | 'custom'
export type WorkspaceEntryKind = 'file' | 'directory'

export interface OpenedFileData {
  path: string
  content: string
}

export interface WorkspaceEntry {
  name: string
  path: string
  kind: WorkspaceEntryKind
}

export interface WorkspaceDirectoryResult {
  entries: WorkspaceEntry[]
  error?: string
}

export interface WorkspaceRenameResult {
  path: string
}

export interface WorkspaceSearchResult {
  path: string
  name: string
  relativePath: string
  excerpt: string | null
  lineNumber: number | null
}

export interface DesktopAPI {
  openFile: () => Promise<OpenedFileData | null>
  pickWorkspaceFolder: () => Promise<string | null>
  readWorkspaceDirectory: (path: string) => Promise<WorkspaceDirectoryResult>
  renameWorkspaceFile: (path: string, nextName: string) => Promise<WorkspaceRenameResult | null>
  deleteWorkspaceFile: (path: string) => Promise<boolean>
  searchWorkspace: (workspaceRoot: string, query: string) => Promise<WorkspaceSearchResult[]>
  createWorkspaceNote: (
    workspaceRoot: string,
    preferredDirectory?: string | null
  ) => Promise<OpenedFileData | null>
  openFileInCurrentWindow: (path: string) => Promise<OpenedFileData | null>
  openDroppedFile: (file: File) => Promise<OpenedFileData | null>
  saveFile: (content: string) => Promise<FileActionResult>
  saveCurrentFileSilently: (content: string) => Promise<boolean>
  saveFileAs: (content: string) => Promise<FileActionResult>
  exportPDF: () => Promise<FileActionResult>
  loadCustomTheme: () => Promise<string | null>
  setLanguage: (language: AppLanguage) => Promise<void>
  setDirtyState: (isDirty: boolean) => Promise<void>
  notifyWindowCloseReady: () => Promise<void>
  rendererReady: () => Promise<OpenedFileData | null>
  onFileChanged: (callback: (content: string) => void) => void
  onFilePathUpdated: (callback: (path: string) => void) => void
  onNewFile: (callback: () => void) => void
  onFileOpened: (callback: (data: OpenedFileData) => void) => void
  onMenuOpen: (callback: () => void) => void
  onOpenSettings: (callback: () => void) => void
  onMenuOpenFolder: (callback: () => void) => void
  onMenuCloseWorkspace: (callback: () => void) => void
  onMenuRefreshWorkspace: (callback: () => void) => void
  onMenuSave: (callback: () => void) => void
  onMenuSaveAs: (callback: () => void) => void
  onMenuExportPDF: (callback: () => void) => void
  onToggleSourceMode: (callback: () => void) => void
  onShowOutline: (callback: () => void) => void
  onSetUITheme: (callback: (theme: UIThemeName) => void) => void
  onSetDocTheme: (callback: (theme: DocThemeName) => void) => void
  onToggleSidebar: (callback: () => void) => void
  onMenuImportTheme: (callback: () => void) => void
  onPrepareWindowClose: (callback: () => void) => void
}
