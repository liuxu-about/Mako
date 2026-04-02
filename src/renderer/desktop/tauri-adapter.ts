import type {
  DesktopAPI,
  DocThemeName,
  FileActionResult,
  OpenedFileData,
  UIThemeName,
  WorkspaceDirectoryResult,
  WorkspaceRenameResult,
  WorkspaceSearchResult
} from '../../shared/desktop'
import {
  translateApp,
  type TranslationKey,
  type TranslationValues
} from '../../shared/localization'
import {
  defaultAppLanguage,
  type AppLanguage
} from '../../shared/language'

type VoidListener = () => void

interface DesktopEventPayloadMap {
  'file-changed': string
  'file-path-updated': string
  'new-file': undefined
  'file-opened': OpenedFileData
  'menu-open': undefined
  'open-settings': undefined
  'menu-open-folder': undefined
  'menu-close-workspace': undefined
  'menu-refresh-workspace': undefined
  'menu-save': undefined
  'menu-save-as': undefined
  'menu-export-pdf': undefined
  'toggle-source-mode': undefined
  'show-outline': undefined
  'set-ui-theme': UIThemeName
  'set-doc-theme': DocThemeName
  'toggle-sidebar': undefined
  'menu-import-theme': undefined
  'prepare-window-close': undefined
}

type DesktopEventName = keyof DesktopEventPayloadMap
type DesktopListener<K extends DesktopEventName> = DesktopEventPayloadMap[K] extends undefined
  ? VoidListener
  : (payload: DesktopEventPayloadMap[K]) => void

function normalizeSingleDialogPath(path: string | string[] | null): string | null {
  if (!path) return null
  return Array.isArray(path) ? path[0] ?? null : path
}

function getFilePathFromDrop(file: File): string | null {
  const candidate = file as File & { path?: string }
  return typeof candidate.path === 'string' && candidate.path.length > 0 ? candidate.path : null
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function pathsMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  return left.toLowerCase() === right.toLowerCase()
}

function getDefaultPdfPath(path: string | null, fallbackName: string): string {
  if (!path) {
    return `${fallbackName}.pdf`
  }

  const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const extensionIndex = path.lastIndexOf('.')

  if (extensionIndex > lastSeparatorIndex) {
    return `${path.slice(0, extensionIndex)}.pdf`
  }

  return `${path}.pdf`
}

function createListenerRegistry() {
  const listeners = new Map<DesktopEventName, Set<(payload: unknown) => void>>()

  const on = <K extends DesktopEventName>(eventName: K, listener: DesktopListener<K>): void => {
    const eventListeners = listeners.get(eventName) ?? new Set()
    eventListeners.add(listener as (payload: unknown) => void)
    listeners.set(eventName, eventListeners)
  }

  const emit = <K extends DesktopEventName>(
    eventName: K,
    payload: DesktopEventPayloadMap[K]
  ): void => {
    listeners.get(eventName)?.forEach((listener) => listener(payload))
  }

  return { on, emit }
}

export function createTauriDesktopAPI(): DesktopAPI {
  const listeners = createListenerRegistry()
  const registeredRuntimeEvents = new Set<DesktopEventName>()

  let currentFilePath: string | null = null
  let currentDirty = false
  let closeRequestedListenerReady = false
  let hasPrepareWindowCloseListener = false
  let isPreparingToClose = false
  let allowImmediateClose = false
  let currentLanguage: AppLanguage = defaultAppLanguage

  const t = (key: TranslationKey, values?: TranslationValues): string => {
    return translateApp(currentLanguage, key, values)
  }

  const getUntitledMarkdownName = (): string => `${t('window.untitled')}.md`
  const getMarkdownDialogFilters = () => [
    { name: t('filter.markdown'), extensions: ['md', 'markdown', 'mdown', 'mkd'] },
    { name: t('filter.text'), extensions: ['txt'] },
    { name: t('filter.allFiles'), extensions: ['*'] }
  ]
  const getMarkdownSaveFilters = () => [
    { name: t('filter.markdown'), extensions: ['md'] },
    { name: t('filter.allFiles'), extensions: ['*'] }
  ]
  const getPdfSaveFilters = () => [{ name: t('filter.pdf'), extensions: ['pdf'] }]
  const getCssDialogFilters = () => [{ name: t('filter.css'), extensions: ['css'] }]

  const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const api = await import('@tauri-apps/api/core')
    return api.invoke<T>(command, args)
  }

  const showErrorDialog = async (title: string, message: string): Promise<void> => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    await dialog.message(message, { title, kind: 'error' })
  }

  const confirmDiscardIfDirty = async (detail: string): Promise<boolean> => {
    if (!currentDirty) {
      return true
    }

    const dialog = await import('@tauri-apps/plugin-dialog')
    return dialog.confirm(`${t('dialog.unsavedChanges.message')}\n\n${detail}`, {
      title: t('dialog.discardChanges.title'),
      kind: 'warning',
      okLabel: t('dialog.button.discardChanges'),
      cancelLabel: t('dialog.button.cancel')
    })
  }

  const confirmReloadFromDisk = async (): Promise<boolean> => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    return dialog.ask(`${t('dialog.reload.message')}\n\n${t('dialog.reload.detail')}`, {
      title: t('dialog.reload.title'),
      kind: 'warning',
      okLabel: t('dialog.button.reloadFromDisk'),
      cancelLabel: t('dialog.button.keepMyChanges')
    })
  }

  const confirmDeleteWorkspaceFile = async (path: string): Promise<boolean> => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    const isCurrentFile = pathsMatch(currentFilePath, path)
    const detail =
      isCurrentFile && currentDirty
        ? t('dialog.deleteNote.detailDirty')
        : t('dialog.deleteNote.detailClean')

    return dialog.confirm(
      `${t('dialog.deleteNote.message', { name: getFileName(path) })}\n\n${detail}`,
      {
        title: t('dialog.deleteNote.title'),
      kind: 'warning',
        okLabel: t('dialog.button.delete'),
        cancelLabel: t('dialog.button.cancel')
      }
    )
  }

  const updateWindowTitle = async (): Promise<void> => {
    await invoke('set_window_title_state', {
      filePath: currentFilePath,
      isDirty: currentDirty,
      language: currentLanguage
    })
  }

  const setTrackedFileState = async (
    filePath: string | null,
    content: string | null
  ): Promise<void> => {
    await invoke('set_tracked_file_state', {
      filePath,
      content
    })
  }

  const readTextFile = async (path: string): Promise<string> => {
    return invoke<string>('read_text_file', { path })
  }

  const writeTextFile = async (path: string, content: string): Promise<void> => {
    await invoke('write_text_file', { path, content })
  }

  const handleExternalFileChange = async (content: string): Promise<void> => {
    if (!currentDirty) {
      listeners.emit('file-changed', content)
      return
    }

    const shouldReload = await confirmReloadFromDisk()
    if (!shouldReload) {
      return
    }

    currentDirty = false
    await updateWindowTitle()
    listeners.emit('file-changed', content)
  }

  const requestWindowClose = async (): Promise<void> => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')

    allowImmediateClose = true
    try {
      await getCurrentWindow().close()
    } catch (error) {
      allowImmediateClose = false
      throw error
    }
  }

  const handleWindowCloseRequested = async (event: { preventDefault: () => void }): Promise<void> => {
    if (allowImmediateClose) {
      allowImmediateClose = false
      isPreparingToClose = false
      return
    }

    if (!currentDirty) {
      isPreparingToClose = false
      return
    }

    event.preventDefault()

    if (isPreparingToClose) {
      return
    }

    if (!currentFilePath || !hasPrepareWindowCloseListener) {
      const shouldDiscard = await confirmDiscardIfDirty(
        t('dialog.detail.discardOnClose')
      )
      if (!shouldDiscard) {
        return
      }

      await requestWindowClose()
      return
    }

    isPreparingToClose = true
    listeners.emit('prepare-window-close', undefined)
  }

  const ensureCloseRequestedListener = async (): Promise<void> => {
    if (closeRequestedListenerReady) {
      return
    }

    closeRequestedListenerReady = true

    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().onCloseRequested((event) => {
      void handleWindowCloseRequested(event)
    })
  }

  const ensureRuntimeListener = async (eventName: DesktopEventName): Promise<void> => {
    if (registeredRuntimeEvents.has(eventName)) {
      return
    }

    registeredRuntimeEvents.add(eventName)

    const { listen } = await import('@tauri-apps/api/event')
    await listen(eventName, (event) => {
      const payload = event.payload as DesktopEventPayloadMap[typeof eventName]

      if (eventName === 'new-file') {
        void (async () => {
          const shouldDiscard = await confirmDiscardIfDirty(
            t('dialog.detail.discardOnNewDraft')
          )
          if (!shouldDiscard) {
            return
          }

          currentFilePath = null
          currentDirty = false
          await setTrackedFileState(null, null)
          await updateWindowTitle()
          listeners.emit('new-file', undefined)
        })()
        return
      }

      if (eventName === 'file-changed' && typeof payload === 'string') {
        void handleExternalFileChange(payload)
        return
      }

      if (
        eventName === 'file-opened' &&
        payload &&
        typeof payload === 'object' &&
        typeof payload.path === 'string' &&
        typeof payload.content === 'string'
      ) {
        void (async () => {
          if (payload.path === currentFilePath) {
            return
          }

          const shouldDiscard = await confirmDiscardIfDirty(
            t('dialog.detail.discardOnOpenOtherFile')
          )
          if (!shouldDiscard) {
            return
          }

          await adoptOpenedFileState(payload)
          listeners.emit('file-opened', payload)
        })()
        return
      }

      if (eventName === 'file-path-updated' && typeof payload === 'string') {
        currentFilePath = payload
      }

      listeners.emit(eventName, payload)
    })
  }

  const registerListener = <K extends DesktopEventName>(
    eventName: K,
    listener: DesktopListener<K>
  ): void => {
    listeners.on(eventName, listener)

    if (eventName === 'prepare-window-close') {
      hasPrepareWindowCloseListener = true
      void ensureCloseRequestedListener()
      return
    }

    void ensureRuntimeListener(eventName)
  }

  const openPathWithDialog = async (): Promise<string | null> => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    return normalizeSingleDialogPath(
      await dialog.open({
        title: t('dialog.openFile.title'),
        multiple: false,
        directory: false,
        filters: getMarkdownDialogFilters()
      })
    )
  }

  const savePathWithDialog = async (defaultPath?: string | null): Promise<string | null> => {
    const dialog = await import('@tauri-apps/plugin-dialog')
    return await dialog.save({
      title: t('dialog.saveFile.title'),
      defaultPath: defaultPath ?? undefined,
      filters: getMarkdownSaveFilters()
    })
  }

  const adoptOpenedFileState = async (openedFile: OpenedFileData): Promise<OpenedFileData> => {
    currentFilePath = openedFile.path
    currentDirty = false
    await setTrackedFileState(openedFile.path, openedFile.content)
    await updateWindowTitle()
    return openedFile
  }

  const loadOpenedFile = async (path: string): Promise<OpenedFileData | null> => {
    if (!path) return null

    const content = await readTextFile(path)
    return adoptOpenedFileState({ path, content })
  }

  void updateWindowTitle()
  void ensureCloseRequestedListener()

  return {
    openFile: async () => {
      try {
        const path = await openPathWithDialog()
        if (!path || path === currentFilePath) return null
        const shouldDiscard = await confirmDiscardIfDirty(
          t('dialog.detail.discardOnOpenOtherFile')
        )
        if (!shouldDiscard) return null
        return await loadOpenedFile(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(t('error.openFailed.title'), t('error.openFailed.selectedFile', { message }))
        console.error('Tauri openFile failed:', error)
        return null
      }
    },
    pickWorkspaceFolder: async () => {
      const dialog = await import('@tauri-apps/plugin-dialog')
      return normalizeSingleDialogPath(
        await dialog.open({
          title: t('dialog.openFolder.title'),
          multiple: false,
          directory: true,
          defaultPath: currentFilePath ?? undefined
        })
      )
    },
    readWorkspaceDirectory: async (path: string): Promise<WorkspaceDirectoryResult> => {
      return invoke<WorkspaceDirectoryResult>('read_workspace_directory', { directoryPath: path })
    },
    renameWorkspaceFile: async (path: string, nextName: string): Promise<WorkspaceRenameResult | null> => {
      try {
        const result = await invoke<WorkspaceRenameResult>('rename_workspace_file', {
          filePath: path,
          requestedName: nextName
        })

        if (currentFilePath === path) {
          currentFilePath = result.path
          const content = await readTextFile(result.path)
          await setTrackedFileState(result.path, content)
          listeners.emit('file-path-updated', result.path)
          await updateWindowTitle()
        }

        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(
          t('error.renameFailed.title'),
          t('error.renameFailed.named', { name: getFileName(path), message })
        )
        console.error('Tauri renameWorkspaceFile failed:', error)
        return null
      }
    },
    deleteWorkspaceFile: async (path: string): Promise<boolean> => {
      const shouldDelete = await confirmDeleteWorkspaceFile(path)
      if (!shouldDelete) {
        return false
      }

      try {
        await invoke('delete_workspace_file', { filePath: path })

        if (pathsMatch(currentFilePath, path)) {
          currentFilePath = null
          currentDirty = false
          await setTrackedFileState(null, null)
          await updateWindowTitle()
        }

        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(
          t('error.deleteFailed.title'),
          t('error.deleteFailed.named', { name: getFileName(path), message })
        )
        console.error('Tauri deleteWorkspaceFile failed:', error)
        return false
      }
    },
    searchWorkspace: async (workspaceRoot: string, query: string): Promise<WorkspaceSearchResult[]> => {
      return invoke<WorkspaceSearchResult[]>('search_workspace', { workspaceRoot, query })
    },
    createWorkspaceNote: async (
      workspaceRoot: string,
      preferredDirectory?: string | null
    ): Promise<OpenedFileData | null> => {
      try {
        const shouldDiscard = await confirmDiscardIfDirty(
          t('dialog.detail.discardOnCreateNote')
        )
        if (!shouldDiscard) return null

        const result = await invoke<OpenedFileData>('create_workspace_note', {
          workspaceRoot,
          preferredDirectory: preferredDirectory ?? null
        })
        return await adoptOpenedFileState(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(t('error.createFailed.title'), t('error.createFailed.newNote', { message }))
        console.error('Tauri createWorkspaceNote failed:', error)
        return null
      }
    },
    openFileInCurrentWindow: async (path: string) => {
      try {
        if (path === currentFilePath) {
          return null
        }

        const shouldDiscard = await confirmDiscardIfDirty(
          t('dialog.detail.discardOnOpenOtherFile')
        )
        if (!shouldDiscard) {
          return null
        }

        return await loadOpenedFile(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(
          t('error.openFailed.title'),
          t('error.openFailed.named', { name: getFileName(path), message })
        )
        console.error('Tauri openFileInCurrentWindow failed:', error)
        return null
      }
    },
    openDroppedFile: async (file: File) => {
      try {
        const path = getFilePathFromDrop(file)
        if (!path || path === currentFilePath) return null

        const shouldDiscard = await confirmDiscardIfDirty(
          t('dialog.detail.discardOnOpenOtherFile')
        )
        if (!shouldDiscard) {
          return null
        }

        return await loadOpenedFile(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(t('error.openFailed.title'), t('error.openFailed.selectedFile', { message }))
        console.error('Tauri openDroppedFile failed:', error)
        return null
      }
    },
    saveFile: async (content: string) => {
      try {
        if (currentFilePath) {
          await writeTextFile(currentFilePath, content)
          currentDirty = false
          await setTrackedFileState(currentFilePath, content)
          await updateWindowTitle()
          return 'success'
        }

        const nextPath = await savePathWithDialog(getUntitledMarkdownName())
        if (!nextPath) {
          return 'cancelled'
        }

        await writeTextFile(nextPath, content)
        currentFilePath = nextPath
        currentDirty = false
        await setTrackedFileState(nextPath, content)
        listeners.emit('file-path-updated', nextPath)
        await updateWindowTitle()
        return 'success'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(
          t('error.saveFailed.title'),
          t('error.saveFailed.named', {
            name: getFileName(currentFilePath ?? getUntitledMarkdownName()),
            message
          })
        )
        console.error('Tauri saveFile failed:', error)
        return 'error'
      }
    },
    saveCurrentFileSilently: async (content: string) => {
      if (!currentFilePath) {
        return false
      }

      try {
        await writeTextFile(currentFilePath, content)
        currentDirty = false
        await setTrackedFileState(currentFilePath, content)
        await updateWindowTitle()
        return true
      } catch (error) {
        console.error('Tauri saveCurrentFileSilently failed:', error)
        return false
      }
    },
    saveFileAs: async (content: string) => {
      try {
        const nextPath = await savePathWithDialog(currentFilePath ?? getUntitledMarkdownName())
        if (!nextPath) {
          return 'cancelled'
        }

        const didChangePath = nextPath !== currentFilePath
        await writeTextFile(nextPath, content)
        currentFilePath = nextPath
        currentDirty = false
        await setTrackedFileState(nextPath, content)
        if (didChangePath) {
          listeners.emit('file-path-updated', nextPath)
        }
        await updateWindowTitle()
        return 'success'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(
          t('error.saveFailed.title'),
          t('error.saveFailed.named', {
            name: getFileName(currentFilePath ?? getUntitledMarkdownName()),
            message
          })
        )
        console.error('Tauri saveFileAs failed:', error)
        return 'error'
      }
    },
    exportPDF: async (): Promise<FileActionResult> => {
      const dialog = await import('@tauri-apps/plugin-dialog')
      const outputPath = await dialog.save({
        title: t('dialog.exportPdf.title'),
        defaultPath: getDefaultPdfPath(currentFilePath, t('window.untitled')),
        filters: getPdfSaveFilters()
      })

      if (!outputPath) {
        return 'cancelled'
      }

      try {
        await invoke('export_pdf', { outputPath })
        return 'success'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(t('error.exportFailed.title'), t('error.exportFailed.message', { message }))
        console.error('Tauri exportPDF failed:', error)
        return 'error'
      }
    },
    loadCustomTheme: async () => {
      const dialog = await import('@tauri-apps/plugin-dialog')
      const path = normalizeSingleDialogPath(
        await dialog.open({
          title: t('dialog.importCustomTheme.title'),
          multiple: false,
          directory: false,
          filters: getCssDialogFilters()
        })
      )

      if (!path) {
        return null
      }

      try {
        return await readTextFile(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await showErrorDialog(
          t('error.themeImportFailed.title'),
          t('error.themeImportFailed.message', { message })
        )
        console.error('Tauri loadCustomTheme failed:', error)
        return null
      }
    },
    setLanguage: async (language: AppLanguage) => {
      currentLanguage = language
      await invoke('set_app_language', { language })
      await updateWindowTitle()
    },
    setDirtyState: async (isDirty: boolean) => {
      currentDirty = Boolean(isDirty)
      await updateWindowTitle()
    },
    notifyWindowCloseReady: async () => {
      if (!isPreparingToClose) {
        return
      }

      isPreparingToClose = false

      if (!currentDirty) {
        await requestWindowClose()
        return
      }

      const shouldDiscard = await confirmDiscardIfDirty(
        t('dialog.detail.discardOnClose')
      )
      if (!shouldDiscard) {
        return
      }

      await requestWindowClose()
    },
    rendererReady: async () => {
      const pendingFile = await invoke<OpenedFileData | null>('renderer_ready')
      if (!pendingFile) {
        return null
      }

      return adoptOpenedFileState(pendingFile)
    },
    onFileChanged: (callback) => registerListener('file-changed', callback),
    onFilePathUpdated: (callback) => registerListener('file-path-updated', callback),
    onNewFile: (callback) => registerListener('new-file', callback),
    onFileOpened: (callback) => registerListener('file-opened', callback),
    onMenuOpen: (callback) => registerListener('menu-open', callback),
    onOpenSettings: (callback) => registerListener('open-settings', callback),
    onMenuOpenFolder: (callback) => registerListener('menu-open-folder', callback),
    onMenuCloseWorkspace: (callback) => registerListener('menu-close-workspace', callback),
    onMenuRefreshWorkspace: (callback) => registerListener('menu-refresh-workspace', callback),
    onMenuSave: (callback) => registerListener('menu-save', callback),
    onMenuSaveAs: (callback) => registerListener('menu-save-as', callback),
    onMenuExportPDF: (callback) => registerListener('menu-export-pdf', callback),
    onToggleSourceMode: (callback) => registerListener('toggle-source-mode', callback),
    onShowOutline: (callback) => registerListener('show-outline', callback),
    onSetUITheme: (callback) => registerListener('set-ui-theme', callback),
    onSetDocTheme: (callback) => registerListener('set-doc-theme', callback),
    onToggleSidebar: (callback) => registerListener('toggle-sidebar', callback),
    onMenuImportTheme: (callback) => registerListener('menu-import-theme', callback),
    onPrepareWindowClose: (callback) => registerListener('prepare-window-close', callback)
  }
}
