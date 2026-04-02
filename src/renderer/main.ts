import {
  createEditor,
  getMarkdown,
  jumpToOutlineHeading,
  setMarkdown,
  subscribeEditorOutline
} from './editor/editor'
import { getDesktopAPI } from './desktop/api'
import { setCurrentRendererLanguage } from './i18n'
import { mountAppShell } from './shell/app-shell'
import { mountSidebar } from './sidebar/sidebar'
import { getAncestorDirectories, getPathDirname, isPathWithinRoot, normalizePath } from './sidebar/tree'
import { createAppStore, loadSavedAppState } from './store/app-store'
import { applyThemeState, isThemeStateChanged, observeSystemThemeChanges } from './themes/theme-manager'
import type { DocThemeName, FileActionResult, OpenedFileData, UIThemeName } from '../shared/desktop'
import './themes/base.css'

async function init(): Promise<void> {
  const api = getDesktopAPI()
  const store = createAppStore(loadSavedAppState())
  const app = document.getElementById('app')
  const sourceEditor = document.getElementById('source-editor') as HTMLTextAreaElement | null

  if (!app || !sourceEditor) {
    throw new Error('Editor shell elements are missing')
  }

  const syncLanguageState = (): void => {
    const { language } = store.getState()
    setCurrentRendererLanguage(language)
    void api.setLanguage(language)
  }

  syncLanguageState()

  let lastSyncedMarkdown = ''
  let isApplyingSyncedContent = false
  let isDirty = false
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightAutoSave: Promise<boolean> | null = null
  let autoSaveRevision = 0
  let pendingDirtyStateSync: Promise<void> = Promise.resolve()
  let sourceModeEnabled = false

  const getCurrentMarkdown = (): string => {
    return sourceModeEnabled ? sourceEditor.value : getMarkdown()
  }

  const waitForLayoutFrame = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  const focusVisualEditor = (): void => {
    requestAnimationFrame(() => {
      const proseMirror = document.querySelector('#editor .ProseMirror') as HTMLElement | null
      proseMirror?.focus()
    })
  }

  const syncVisualEditorFromSource = (): void => {
    if (!sourceModeEnabled) {
      return
    }

    const sourceMarkdown = sourceEditor.value
    if (getMarkdown() === sourceMarkdown) {
      return
    }

    isApplyingSyncedContent = true
    try {
      setMarkdown(sourceMarkdown)
    } finally {
      isApplyingSyncedContent = false
    }
  }

  const syncEditorMode = (nextSourceModeEnabled: boolean): void => {
    if (sourceModeEnabled === nextSourceModeEnabled) {
      return
    }

    if (nextSourceModeEnabled) {
      sourceEditor.value = getMarkdown()
      sourceModeEnabled = true
      app.dataset.editorMode = 'source'
      requestAnimationFrame(() => {
        sourceEditor.focus()
        sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
      })
      return
    }

    const sourceMarkdown = sourceEditor.value
    sourceModeEnabled = false
    app.dataset.editorMode = 'wysiwyg'

    syncVisualEditorFromSource()

    focusVisualEditor()
  }

  const clearAutoSaveTimer = (): void => {
    if (!autoSaveTimer) return
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  const canAutoSave = (): boolean => {
    return Boolean(store.getState().activeFilePath)
  }

  const performAutoSave = async (): Promise<boolean> => {
    clearAutoSaveTimer()

    if (isApplyingSyncedContent || !canAutoSave()) {
      return false
    }

    const markdown = getCurrentMarkdown()
    if (markdown === lastSyncedMarkdown) {
      await syncDirtyState(false)
      return true
    }

    const revisionAtStart = ++autoSaveRevision
    const savePromise = api.saveCurrentFileSilently(markdown)
    inFlightAutoSave = savePromise

    try {
      const saved = await savePromise
      if (!saved) return false

      // Ignore stale completions if a newer autosave has already started.
      if (revisionAtStart !== autoSaveRevision) {
        return true
      }

      lastSyncedMarkdown = markdown
      await syncDirtyState(false)
      return true
    } finally {
      if (inFlightAutoSave === savePromise) {
        inFlightAutoSave = null
      }
    }
  }

  const scheduleAutoSave = (): void => {
    if (!canAutoSave()) return

    clearAutoSaveTimer()
    autoSaveTimer = setTimeout(() => {
      void performAutoSave()
    }, 250)
  }

  const flushPendingAutoSave = async (): Promise<void> => {
    clearAutoSaveTimer()
    if (inFlightAutoSave) {
      await inFlightAutoSave
      await pendingDirtyStateSync
      return
    }

    if (isDirty && canAutoSave()) {
      await performAutoSave()
      return
    }

    await pendingDirtyStateSync
  }

  const exportCurrentDocumentAsPdf = async (): Promise<FileActionResult> => {
    const editor = document.getElementById('editor') as HTMLDivElement | null
    const editorScrollTop = editor?.scrollTop ?? 0

    syncVisualEditorFromSource()

    document.documentElement.classList.add('pdf-export-active')
    document.body.classList.add('pdf-export-active')

    try {
      await waitForLayoutFrame()
      await waitForLayoutFrame()
      window.scrollTo(0, 0)
      return await api.exportPDF()
    } finally {
      document.documentElement.classList.remove('pdf-export-active')
      document.body.classList.remove('pdf-export-active')
      await waitForLayoutFrame()
      if (editor) {
        editor.scrollTop = editorScrollTop
      }
    }
  }

  const syncFileContext = (filePath: string | null): void => {
    if (!filePath) {
      store.setState((state) => {
        if (state.workspaceRootSource === 'explicit') {
          return { activeFilePath: null }
        }

        return {
          activeFilePath: null,
          workspaceRoot: null,
          workspaceRootSource: null,
          expandedDirs: []
        }
      })
      return
    }

    store.setState((state) => {
      const normalizedFilePath = normalizePath(filePath)
      const hasExplicitWorkspace =
        state.workspaceRootSource === 'explicit' && Boolean(state.workspaceRoot)
      const nextWorkspaceRoot = hasExplicitWorkspace
        ? normalizePath(state.workspaceRoot as string)
        : normalizePath(getPathDirname(normalizedFilePath))
      const nextWorkspaceRootSource = hasExplicitWorkspace ? 'explicit' as const : 'inferred' as const

      const expandedDirs = new Set(
        state.expandedDirs.filter((directoryPath) => isPathWithinRoot(nextWorkspaceRoot, directoryPath))
      )

      if (isPathWithinRoot(nextWorkspaceRoot, normalizedFilePath)) {
        getAncestorDirectories(nextWorkspaceRoot, normalizedFilePath).forEach((directoryPath) => {
          expandedDirs.add(directoryPath)
        })
      }

      return {
        activeFilePath: normalizedFilePath,
        workspaceRoot: nextWorkspaceRoot,
        workspaceRootSource: nextWorkspaceRootSource,
        expandedDirs: Array.from(expandedDirs)
      }
    })
  }

  const openWorkspaceFolder = async (): Promise<void> => {
    await flushPendingAutoSave()
    const workspaceRoot = await api.pickWorkspaceFolder()
    if (!workspaceRoot) return

    const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
    const nextExpandedDirs = new Set<string>([normalizedWorkspaceRoot])
    const activeFilePath = store.getState().activeFilePath

    if (activeFilePath && isPathWithinRoot(normalizedWorkspaceRoot, activeFilePath)) {
      getAncestorDirectories(normalizedWorkspaceRoot, activeFilePath).forEach((directoryPath) => {
        nextExpandedDirs.add(directoryPath)
      })
    }

    store.setState({
      workspaceRoot: normalizedWorkspaceRoot,
      workspaceRootSource: 'explicit',
      sidebarCollapsed: false,
      expandedDirs: Array.from(nextExpandedDirs)
    })
  }

  const closeWorkspace = (): void => {
    const activeFilePath = store.getState().activeFilePath

    store.setState({
      workspaceRoot: null,
      workspaceRootSource: null,
      expandedDirs: []
    })

    if (activeFilePath) {
      syncFileContext(activeFilePath)
      return
    }

    store.setState({ activeFilePath: null })
  }

  const openFileFromWorkspace = async (filePath: string): Promise<void> => {
    await flushPendingAutoSave()
    const result = await api.openFileInCurrentWindow(filePath)
    if (!result) return
    handleOpenedFile(result)
  }

  let sidebar: ReturnType<typeof mountSidebar> | null = null

  const createWorkspaceNote = async (
    workspaceRoot: string,
    activeFilePath: string | null
  ): Promise<void> => {
    await flushPendingAutoSave()
    const preferredDirectory =
      activeFilePath && isPathWithinRoot(workspaceRoot, activeFilePath)
        ? getPathDirname(activeFilePath)
        : workspaceRoot

    const result = await api.createWorkspaceNote(workspaceRoot, preferredDirectory)
    if (!result) return

    handleOpenedFile(result)
    sidebar?.refresh()
  }

  applyThemeState(store.getState())

  const appShell = mountAppShell(store)
  sidebar = mountSidebar(store, {
    loadDirectory: (directoryPath) => api.readWorkspaceDirectory(directoryPath),
    searchWorkspace: (workspaceRoot, query) => api.searchWorkspace(workspaceRoot, query),
    openFile: (filePath) => openFileFromWorkspace(filePath),
    renameFile: async (filePath, nextName) => {
      if (store.getState().activeFilePath === normalizePath(filePath)) {
        await flushPendingAutoSave()
      }

      const result = await api.renameWorkspaceFile(filePath, nextName)
      return result?.path ?? null
    },
    deleteFile: async (filePath) => {
      const normalizedFilePath = normalizePath(filePath)
      const isActiveFile = store.getState().activeFilePath === normalizedFilePath

      if (isActiveFile) {
        clearAutoSaveTimer()
        if (inFlightAutoSave) {
          await inFlightAutoSave
        }
      }

      const didDelete = await api.deleteWorkspaceFile(filePath)
      if (!didDelete) {
        return false
      }

      if (isActiveFile) {
        syncFileContext(null)
        await applySyncedContent('')
        focusActiveEditor()
      }

      sidebar?.refresh()
      return true
    },
    openWorkspace: () => openWorkspaceFolder(),
    closeWorkspace,
    createWorkspaceNote,
    jumpToOutlineHeading: (headingId) => {
      if (sourceModeEnabled) {
        syncEditorMode(false)
      }
      jumpToOutlineHeading(headingId)
    }
  })
  const cleanups: Array<() => void> = [
    appShell.destroy,
    () => sidebar?.destroy(),
    subscribeEditorOutline((nextOutlineState) => {
      sidebar?.setOutlineState(nextOutlineState)
    }),
    store.subscribe((state, previousState) => {
      if (state.language !== previousState.language) {
        syncLanguageState()
      }

      if (isThemeStateChanged(state, previousState)) {
        applyThemeState(state)
      }
    }),
    observeSystemThemeChanges(() => {
      if (store.getState().uiTheme === 'system') {
        applyThemeState(store.getState())
      }
    })
  ]

  window.addEventListener(
    'beforeunload',
    () => {
      cleanups.splice(0).forEach((cleanup) => cleanup())
    },
    { once: true }
  )

  const syncDirtyState = (nextDirty: boolean): Promise<void> => {
    if (isDirty === nextDirty) return pendingDirtyStateSync
    isDirty = nextDirty
    pendingDirtyStateSync = api.setDirtyState(nextDirty)
    return pendingDirtyStateSync
  }

  const applySyncedContent = async (
    content: string
  ): Promise<void> => {
    clearAutoSaveTimer()
    isApplyingSyncedContent = true
    try {
      setMarkdown(content)
      sourceEditor.value = content
    } finally {
      isApplyingSyncedContent = false
    }
    lastSyncedMarkdown = content
    await syncDirtyState(false)
  }

  const handleOpenedFile = (data: OpenedFileData): void => {
    clearAutoSaveTimer()
    syncFileContext(data.path)

    if (getCurrentMarkdown() !== data.content) {
      void applySyncedContent(data.content)
      return
    }

    sourceEditor.value = data.content
    lastSyncedMarkdown = data.content
    void syncDirtyState(false)
  }

  const handleSaveResult = (result: FileActionResult, markdown: string): void => {
    if (result !== 'success') return
    lastSyncedMarkdown = markdown
    syncDirtyState(false)
  }

  await createEditor('editor', (markdown) => {
    if (isApplyingSyncedContent) return
    if (sourceModeEnabled) return
    syncDirtyState(markdown !== lastSyncedMarkdown)
    if (markdown !== lastSyncedMarkdown) {
      scheduleAutoSave()
    } else {
      clearAutoSaveTimer()
    }
  })

  lastSyncedMarkdown = getMarkdown()
  app.dataset.editorMode = 'wysiwyg'

  sourceEditor.addEventListener('input', () => {
    if (isApplyingSyncedContent || !sourceModeEnabled) return
    const markdown = sourceEditor.value
    syncDirtyState(markdown !== lastSyncedMarkdown)
    if (markdown !== lastSyncedMarkdown) {
      scheduleAutoSave()
    } else {
      clearAutoSaveTimer()
    }
  })

  document.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      (event.code === 'Comma' || event.key === ',')
    ) {
      event.preventDefault()
      store.setState({ settingsOpen: true })
    }
  })

  api.onMenuOpen(async () => {
    await flushPendingAutoSave()
    const result = await api.openFile()
    if (result) handleOpenedFile(result)
  })
  api.onOpenSettings(() => {
    store.setState({ settingsOpen: true })
  })
  api.onMenuOpenFolder(() => {
    void openWorkspaceFolder()
  })
  api.onMenuCloseWorkspace(() => {
    closeWorkspace()
  })
  api.onMenuRefreshWorkspace(() => {
    sidebar.refresh()
  })

  api.onMenuSave(async () => {
    syncVisualEditorFromSource()
    const markdown = getCurrentMarkdown()
    handleSaveResult(await api.saveFile(markdown), markdown)
  })

  api.onMenuSaveAs(async () => {
    syncVisualEditorFromSource()
    const markdown = getCurrentMarkdown()
    handleSaveResult(await api.saveFileAs(markdown), markdown)
  })

  api.onMenuExportPDF(() => {
    void exportCurrentDocumentAsPdf()
  })
  api.onToggleSourceMode(() => {
    syncEditorMode(!sourceModeEnabled)
  })
  api.onShowOutline(() => {
    store.setState({
      sidebarCollapsed: false,
      sidebarTab: 'outline'
    })
  })
  api.onNewFile(() => {
    clearAutoSaveTimer()
    syncFileContext(null)
    void applySyncedContent('')
  })
  api.onFileOpened((data) => {
    handleOpenedFile(data)
  })
  api.onFileChanged((content) => {
    void applySyncedContent(content)
  })
  api.onFilePathUpdated((path) => {
    syncFileContext(path)
  })
  api.onSetUITheme((theme: UIThemeName) => {
    store.setState({ uiTheme: theme })
  })
  api.onSetDocTheme((theme: DocThemeName) => {
    store.setState({ docTheme: theme })
  })
  api.onToggleSidebar(() => {
    store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed })
  })

  api.onMenuImportTheme(async () => {
    const css = await api.loadCustomTheme()
    if (css) {
      store.setState({ docTheme: 'custom', customDocThemeCSS: css })
    }
  })
  api.onPrepareWindowClose(() => {
    void (async () => {
      try {
        await flushPendingAutoSave()
      } finally {
        await api.notifyWindowCloseReady()
      }
    })()
  })

  const pendingFile = await api.rendererReady()
  if (pendingFile) {
    handleOpenedFile(pendingFile)
  }

  const hasFileDrop = (event: DragEvent): boolean => {
    return Boolean(event.dataTransfer?.files?.length)
  }

  document.addEventListener('dragover', (event) => {
    if (!hasFileDrop(event)) return
    event.preventDefault()
  })

  document.addEventListener('drop', async (event) => {
    if (!hasFileDrop(event)) return
    event.preventDefault()
    await flushPendingAutoSave()
    const file = event.dataTransfer?.files[0]
    if (!file) return
    const result = await api.openDroppedFile(file)
    if (result) handleOpenedFile(result)
  })
}

init().catch((error) => console.error('Mako init failed:', error))
