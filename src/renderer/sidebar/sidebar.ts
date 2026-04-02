import type {
  WorkspaceDirectoryResult,
  WorkspaceEntry,
  WorkspaceSearchResult
} from '../../shared/desktop'
import { translateApp } from '../../shared/localization'
import type { EditorOutlineState } from '../editor/editor'
import type { AppState, AppStore, SidebarTabName } from '../store/app-store'
import { getPathBasename, isPathWithinRoot, normalizePath } from './tree'

interface SidebarActions {
  loadDirectory: (directoryPath: string) => Promise<WorkspaceDirectoryResult>
  searchWorkspace: (workspaceRoot: string, query: string) => Promise<WorkspaceSearchResult[]>
  openFile: (filePath: string) => Promise<void>
  renameFile: (filePath: string, nextName: string) => Promise<string | null>
  deleteFile: (filePath: string) => Promise<boolean>
  openWorkspace: () => Promise<void> | void
  closeWorkspace: () => void
  createWorkspaceNote: (workspaceRoot: string, activeFilePath: string | null) => Promise<void>
  jumpToOutlineHeading: (headingId: string) => void
}

interface SidebarController {
  refresh: () => void
  setOutlineState: (nextOutlineState: EditorOutlineState) => void
  destroy: () => void
}

interface SidebarContextMenuState {
  path: string
  name: string
  x: number
  y: number
}

type IconName =
  | 'menu'
  | 'search'
  | 'plus'
  | 'more'
  | 'folder'
  | 'file'
  | 'chevron-right'
  | 'chevron-down'
  | 'compose'

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  if (className) element.className = className
  if (typeof textContent === 'string') element.textContent = textContent
  return element
}

function getIconMarkup(icon: IconName): string {
  switch (icon) {
    case 'menu':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 4.5h10" />
          <path d="M3 8h8" />
          <path d="M3 11.5h10" />
        </svg>
      `
    case 'search':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="7" cy="7" r="4.25" />
          <path d="m10.5 10.5 2.75 2.75" />
        </svg>
      `
    case 'plus':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M8 3v10" />
          <path d="M3 8h10" />
        </svg>
      `
    case 'more':
      return `
        <svg viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3.25" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="8" cy="12.75" r="1.25" />
        </svg>
      `
    case 'folder':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
          <path d="M1.75 4.5A1.75 1.75 0 0 1 3.5 2.75h2l1.25 1.5H12.5A1.75 1.75 0 0 1 14.25 6v5.5a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 1.75 11.5z" fill="currentColor" stroke="none" />
        </svg>
      `
    case 'file':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 2.5h5l3 3v8A1.5 1.5 0 0 1 10.5 15h-6A1.5 1.5 0 0 1 3 13.5V4A1.5 1.5 0 0 1 4.5 2.5Z" />
          <path d="M9 2.75V5.5h2.75" />
          <path d="M5.5 8h5" />
          <path d="M5.5 10.5h5" />
        </svg>
      `
    case 'chevron-right':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 3.75 4 4.25-4 4.25" />
        </svg>
      `
    case 'chevron-down':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3.75 6 4.25 4 4.25-4" />
        </svg>
      `
    case 'compose':
      return `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="m10.75 3.25 2 2" />
          <path d="m3 13 2.75-.5 6.5-6.5a1.4 1.4 0 0 0-2-2l-6.5 6.5Z" />
          <path d="M8.75 4.75 11.25 7.25" />
        </svg>
      `
  }
}

function createIconElement(icon: IconName, className: string): HTMLSpanElement {
  const iconElement = createElement('span', className)
  iconElement.setAttribute('aria-hidden', 'true')
  iconElement.innerHTML = getIconMarkup(icon)
  return iconElement
}

function createIconButton(options: {
  label: string
  icon: IconName
  onClick: () => void
  className?: string
  pressed?: boolean
  disabled?: boolean
}): HTMLButtonElement {
  const button = createElement(
    'button',
    ['sidebar__icon-button', options.className].filter(Boolean).join(' ')
  )
  button.type = 'button'
  button.setAttribute('aria-label', options.label)
  if (typeof options.pressed === 'boolean') {
    button.setAttribute('aria-pressed', String(options.pressed))
  }
  if (options.disabled) {
    button.disabled = true
  } else {
    button.addEventListener('click', options.onClick)
  }
  button.append(createIconElement(options.icon, 'sidebar__icon'))
  return button
}

function createTextButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = createElement('button', 'sidebar__text-button', label)
  button.type = 'button'
  button.addEventListener('click', onClick)
  return button
}

function createTreeMessage(copy: string, className = 'sidebar__tree-message'): HTMLElement {
  return createElement('div', className, copy)
}

function normalizeEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.map((entry) => ({
    ...entry,
    path: normalizePath(entry.path)
  }))
}

function getFileExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.')
  if (extensionIndex <= 0) return ''
  return fileName.slice(extensionIndex)
}

function getRenameSelectionEnd(fileName: string): number {
  const extension = getFileExtension(fileName)
  if (!extension) return fileName.length
  return Math.max(0, fileName.length - extension.length)
}

function isDirectoryExpanded(state: AppState, directoryPath: string): boolean {
  return state.expandedDirs.some((expandedPath) => normalizePath(expandedPath) === directoryPath)
}

function matchesSearch(entry: WorkspaceEntry, query: string): boolean {
  if (!query) return true
  return entry.name.toLowerCase().includes(query)
}

export function mountSidebar(store: AppStore, actions: SidebarActions): SidebarController {
  const sidebarBody = document.getElementById('sidebar-body')

  if (!sidebarBody) {
    throw new Error('Sidebar elements are missing')
  }

  let destroyed = false
  let currentWorkspaceRoot: string | null = null
  let cachedEntries = new Map<string, WorkspaceEntry[]>()
  let directoryErrors = new Map<string, string>()
  let loadingDirectories = new Set<string>()
  let loadGeneration = 0
  let outlineState: EditorOutlineState = {
    items: [],
    activeHeadingId: null
  }
  let searchQuery = ''
  let searchResults: WorkspaceSearchResult[] = []
  let searchLoading = false
  let searchError: string | null = null
  let searchGeneration = 0
  let lastSearchKey = ''
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchFocusPending = false
  let searchSelectionStart: number | null = null
  let searchSelectionEnd: number | null = null
  let moreMenuOpen = false
  let renamingPath: string | null = null
  let renamingDraft = ''
  let renameCommitPath: string | null = null
  let renameFocusPath: string | null = null
  let pendingFileOpenTimer: ReturnType<typeof setTimeout> | null = null
  let contextMenuState: SidebarContextMenuState | null = null

  const t = (key: Parameters<typeof translateApp>[1], values?: Parameters<typeof translateApp>[2]) => {
    return translateApp(store.getState().language, key, values)
  }

  const setSidebarTab = (tab: SidebarTabName): void => {
    if (store.getState().sidebarTab === tab) {
      return
    }

    contextMenuState = null
    store.setState({ sidebarTab: tab })
  }

  const resetWorkspaceState = (): void => {
    loadGeneration += 1
    cachedEntries = new Map()
    directoryErrors = new Map()
    loadingDirectories = new Set()
  }

  const clearPendingFileOpen = (): void => {
    if (!pendingFileOpenTimer) return
    clearTimeout(pendingFileOpenTimer)
    pendingFileOpenTimer = null
  }

  const clearSearchTimer = (): void => {
    if (!searchTimer) return
    clearTimeout(searchTimer)
    searchTimer = null
  }

  const resetSearchResults = (): void => {
    clearSearchTimer()
    searchResults = []
    searchLoading = false
    searchError = null
    lastSearchKey = ''
    searchFocusPending = false
    searchSelectionStart = null
    searchSelectionEnd = null
    searchGeneration += 1
  }

  const focusSearchInput = (): void => {
    requestAnimationFrame(() => {
      const input = document.getElementById('sidebar-search-input') as HTMLInputElement | null
      input?.focus()
      if (searchSelectionStart !== null && searchSelectionEnd !== null) {
        input?.setSelectionRange(searchSelectionStart, searchSelectionEnd)
        searchSelectionStart = null
        searchSelectionEnd = null
        return
      }
      input?.select()
    })
  }

  const refreshWorkspace = (): void => {
    if (!currentWorkspaceRoot) return
    contextMenuState = null
    resetWorkspaceState()
    if (searchQuery.trim().length > 0) {
      lastSearchKey = ''
    }
    render(store.getState())
  }

  const removeDeletedFileFromSidebar = (filePath: string): void => {
    const normalizedFilePath = normalizePath(filePath)

    cachedEntries = new Map(
      Array.from(cachedEntries.entries(), ([directoryPath, entries]) => [
        directoryPath,
        entries.filter((entry) => normalizePath(entry.path) !== normalizedFilePath)
      ])
    )
    searchResults = searchResults.filter(
      (result) => normalizePath(result.path) !== normalizedFilePath
    )

    if (renamingPath === normalizedFilePath) {
      renamingPath = null
      renamingDraft = ''
      renameCommitPath = null
      renameFocusPath = null
    }

    if (contextMenuState?.path === normalizedFilePath) {
      contextMenuState = null
    }

    clearPendingFileOpen()
    render(store.getState())
  }

  const cancelRename = (): void => {
    renamingPath = null
    renamingDraft = ''
    renameCommitPath = null
    renameFocusPath = null
    render(store.getState())
  }

  const beginRename = (entryPath: string, entryName: string): void => {
    clearPendingFileOpen()
    contextMenuState = null
    renamingPath = entryPath
    renamingDraft = entryName
    renameCommitPath = null
    renameFocusPath = entryPath
    moreMenuOpen = false
    render(store.getState())
  }

  const commitRename = async (entryPath: string): Promise<void> => {
    if (renamingPath !== entryPath || renameCommitPath === entryPath) {
      return
    }

    const currentName = getPathBasename(entryPath)
    const nextName = renamingDraft.trim()
    if (!nextName || nextName === currentName) {
      cancelRename()
      return
    }

    renameCommitPath = entryPath
    const renamedPath = await actions.renameFile(entryPath, nextName)
    renameCommitPath = null

    if (!renamedPath) {
      renameFocusPath = entryPath
      render(store.getState())
      return
    }

    renamingPath = null
    renamingDraft = ''
    renameFocusPath = null
    refreshWorkspace()
  }

  const closeTransientUI = (): void => {
    if (!moreMenuOpen && searchQuery.length === 0 && !contextMenuState) return
    clearPendingFileOpen()
    if (searchQuery.length > 0) {
      resetSearchResults()
      searchQuery = ''
    }
    moreMenuOpen = false
    contextMenuState = null
    render(store.getState())
  }

  const scheduleWorkspaceSearch = (workspaceRoot: string | null, rawQuery: string): void => {
    clearSearchTimer()
    const normalizedQuery = rawQuery.trim()

    if (!workspaceRoot || normalizedQuery.length === 0) {
      resetSearchResults()
      render(store.getState())
      return
    }

    const nextSearchKey = `${workspaceRoot}::${normalizedQuery.toLowerCase()}`
    lastSearchKey = nextSearchKey
    searchLoading = true
    searchError = null
    render(store.getState())

    const requestGeneration = ++searchGeneration
    searchTimer = setTimeout(() => {
      searchTimer = null
      void actions
        .searchWorkspace(workspaceRoot, normalizedQuery)
        .then((results) => {
          if (destroyed || requestGeneration !== searchGeneration || lastSearchKey !== nextSearchKey) {
            return
          }

          searchResults = results
          searchLoading = false
          searchError = null
          render(store.getState())
        })
        .catch((error) => {
          if (destroyed || requestGeneration !== searchGeneration || lastSearchKey !== nextSearchKey) {
            return
          }

          searchResults = []
          searchLoading = false
          searchError = error instanceof Error ? error.message : ''
          render(store.getState())
        })
    }, 160)
  }

  const retryDirectoryLoad = (directoryPath: string): void => {
    const normalizedDirectoryPath = normalizePath(directoryPath)
    directoryErrors.delete(normalizedDirectoryPath)
    cachedEntries.delete(normalizedDirectoryPath)
    loadingDirectories.delete(normalizedDirectoryPath)
    render(store.getState())
  }

  const toggleDirectory = (directoryPath: string): void => {
    const normalizedDirectoryPath = normalizePath(directoryPath)
    store.setState((state) => {
      if (isDirectoryExpanded(state, normalizedDirectoryPath)) {
        return {
          expandedDirs: state.expandedDirs.filter(
            (path) =>
              normalizePath(path) !== normalizedDirectoryPath &&
              !isPathWithinRoot(normalizedDirectoryPath, path)
          )
        }
      }

      return {
        expandedDirs: [...state.expandedDirs, normalizedDirectoryPath]
      }
    })
  }

  const toggleMoreMenu = (): void => {
    contextMenuState = null
    moreMenuOpen = !moreMenuOpen
    render(store.getState())
  }

  const openContextMenu = (
    filePath: string,
    fileName: string,
    x: number,
    y: number
  ): void => {
    clearPendingFileOpen()
    moreMenuOpen = false
    contextMenuState = {
      path: normalizePath(filePath),
      name: fileName,
      x,
      y
    }
    render(store.getState())
  }

  const ensureDirectoryLoaded = (directoryPath: string): void => {
    const normalizedDirectoryPath = normalizePath(directoryPath)
    if (destroyed) return
    if (
      cachedEntries.has(normalizedDirectoryPath) ||
      loadingDirectories.has(normalizedDirectoryPath) ||
      directoryErrors.has(normalizedDirectoryPath)
    ) {
      return
    }

    const requestGeneration = loadGeneration
    const requestWorkspaceRoot = currentWorkspaceRoot

    loadingDirectories.add(normalizedDirectoryPath)

    void actions
      .loadDirectory(normalizedDirectoryPath)
      .then((result) => {
        if (
          destroyed ||
          requestGeneration !== loadGeneration ||
          requestWorkspaceRoot !== currentWorkspaceRoot
        ) {
          return
        }

        cachedEntries.set(normalizedDirectoryPath, normalizeEntries(result.entries))
        if (result.error) {
          directoryErrors.set(normalizedDirectoryPath, result.error)
        } else {
          directoryErrors.delete(normalizedDirectoryPath)
        }
      })
      .catch((error) => {
        if (destroyed) return

        if (
          requestGeneration !== loadGeneration ||
          requestWorkspaceRoot !== currentWorkspaceRoot
        ) {
          return
        }

        cachedEntries.delete(normalizedDirectoryPath)
        directoryErrors.set(
          normalizedDirectoryPath,
          error instanceof Error ? error.message : ''
        )
      })
      .finally(() => {
        if (destroyed) return
        if (
          requestGeneration !== loadGeneration ||
          requestWorkspaceRoot !== currentWorkspaceRoot
        ) {
          return
        }

        loadingDirectories.delete(normalizedDirectoryPath)
        render(store.getState())
      })
  }

  const createTabButton = (
    label: string,
    tab: SidebarTabName,
    activeTab: SidebarTabName
  ): HTMLButtonElement => {
    const button = createElement(
      'button',
      ['sidebar__tab', activeTab === tab ? 'sidebar__tab--active' : ''].filter(Boolean).join(' '),
      label
    )
    button.type = 'button'
    button.setAttribute('aria-pressed', String(activeTab === tab))
    button.addEventListener('click', () => {
      moreMenuOpen = false
      setSidebarTab(tab)
    })
    return button
  }

  const createTopBar = (state: AppState): HTMLElement => {
    const topBar = createElement('div', 'sidebar__topbar')
    const tabs = createElement('div', 'sidebar__tabs')
    tabs.append(
      createTabButton(t('sidebar.tab.files'), 'files', state.sidebarTab),
      createTabButton(t('sidebar.tab.outline'), 'outline', state.sidebarTab)
    )
    topBar.append(tabs)
    return topBar
  }

  const createSearchBar = (): HTMLElement => {
    const search = createElement('div', 'sidebar__search')
    const icon = createIconElement('search', 'sidebar__search-icon')
    const input = createElement('input', 'sidebar__search-input') as HTMLInputElement
    input.id = 'sidebar-search-input'
    input.type = 'search'
    input.placeholder = t('sidebar.search.placeholder')
    input.value = searchQuery
    input.autocomplete = 'off'
    input.spellcheck = false
    input.addEventListener('input', () => {
      searchQuery = input.value
      searchFocusPending = true
      searchSelectionStart = input.selectionStart
      searchSelectionEnd = input.selectionEnd
      scheduleWorkspaceSearch(currentWorkspaceRoot, searchQuery)
    })
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      searchQuery = ''
      input.value = ''
      resetSearchResults()
      render(store.getState())
    })

    search.append(icon, input)
    return search
  }

  const createMoreMenu = (state: AppState, workspaceRoot: string | null): HTMLElement => {
    const menuWrap = createElement('div', 'sidebar__menu-wrap')
    const button = createIconButton({
      label: moreMenuOpen ? t('sidebar.more.close') : t('sidebar.more.open'),
      icon: 'more',
      onClick: toggleMoreMenu,
      pressed: moreMenuOpen,
      className: 'sidebar__bottom-action'
    })

    menuWrap.append(button)

    if (!moreMenuOpen) {
      return menuWrap
    }

    const menu = createElement('div', 'sidebar__menu')
    const appendMenuAction = (label: string, onClick: () => void, destructive = false): void => {
      const item = createElement(
        'button',
        destructive ? 'sidebar__menu-item sidebar__menu-item--danger' : 'sidebar__menu-item',
        label
      )
      item.type = 'button'
      item.addEventListener('click', () => {
        moreMenuOpen = false
        onClick()
      })
      menu.append(item)
    }

    appendMenuAction(t('sidebar.action.openFolder'), () => {
      void actions.openWorkspace()
    })

    if (workspaceRoot) {
      appendMenuAction(t('sidebar.action.refreshWorkspace'), refreshWorkspace)
      if (state.workspaceRootSource === 'explicit') {
        appendMenuAction(t('sidebar.action.closeWorkspace'), actions.closeWorkspace, true)
      }
    }

    menuWrap.append(menu)
    return menuWrap
  }

  const createBottomBar = (state: AppState, workspaceRoot: string | null): HTMLElement => {
    const bottomBar = createElement('div', 'sidebar__bottombar')
    const info = createElement('div', 'sidebar__workspace')
    const infoIcon = createIconElement('folder', 'sidebar__workspace-icon')
    const infoText = createElement('div', 'sidebar__workspace-text')
    const infoTitle = createElement(
      'div',
      'sidebar__workspace-name',
      workspaceRoot ? getPathBasename(workspaceRoot) : t('sidebar.workspace.none')
    )
    infoTitle.title = workspaceRoot ?? t('sidebar.workspace.openFolderHint')

    infoText.append(infoTitle)
    info.append(infoIcon, infoText)

    const actionsRow = createElement('div', 'sidebar__bottom-actions')
    actionsRow.append(
      createIconButton({
        label: t('sidebar.action.createNote'),
        icon: 'plus',
        onClick: () => {
          if (!workspaceRoot) return
          void actions.createWorkspaceNote(workspaceRoot, state.activeFilePath)
        },
        className: 'sidebar__bottom-action',
        disabled: !workspaceRoot
      }),
      createMoreMenu(state, workspaceRoot)
    )

    bottomBar.append(info, actionsRow)
    return bottomBar
  }

  const createEmptyState = (): HTMLElement => {
    const emptyState = createElement('section', 'sidebar__empty')
    const title = createElement('div', 'sidebar__empty-title', t('sidebar.empty.title'))
    const copy = createElement('div', 'sidebar__empty-copy', t('sidebar.empty.copy'))
    emptyState.append(
      title,
      copy,
      createTextButton(t('sidebar.action.openFolder'), () => void actions.openWorkspace())
    )
    return emptyState
  }

  const buildEntryNode = (
    entry: WorkspaceEntry,
    state: AppState,
    depth: number,
    query: string
  ): HTMLElement | null => {
    const normalizedEntryPath = normalizePath(entry.path)

    if (entry.kind === 'directory') {
      const searchActive = Boolean(query)
      const expanded = searchActive || isDirectoryExpanded(state, normalizedEntryPath)
      const children = cachedEntries.get(normalizedEntryPath)
      const childError = directoryErrors.get(normalizedEntryPath)
      const childLoading = loadingDirectories.has(normalizedEntryPath)
      const visibleChildren = expanded && children
        ? children
            .map((childEntry) => buildEntryNode(childEntry, state, depth + 1, query))
            .filter((child): child is HTMLElement => Boolean(child))
        : []
      const shouldShow =
        !searchActive ||
        matchesSearch(entry, query) ||
        visibleChildren.length > 0 ||
        childLoading

      if (!shouldShow) {
        return null
      }

      const node = createElement('div', 'sidebar__tree-node')
      const row = createElement(
        'button',
        [
          'sidebar__tree-row',
          'sidebar__tree-row--directory',
          state.activeFilePath === normalizedEntryPath ? 'sidebar__tree-row--active' : ''
        ]
          .filter(Boolean)
          .join(' ')
      )

      row.type = 'button'
      row.style.setProperty('--tree-depth', String(depth))
      row.title = entry.path
      row.setAttribute('aria-expanded', String(expanded))
      row.append(
        createIconElement(expanded ? 'chevron-down' : 'chevron-right', 'sidebar__tree-caret'),
        createIconElement('folder', 'sidebar__tree-icon sidebar__tree-icon--folder'),
        createElement('span', 'sidebar__tree-name', entry.name)
      )

      if (!searchActive) {
        row.addEventListener('click', () => {
          toggleDirectory(normalizedEntryPath)
        })
      }

      node.append(row)

      if (!expanded) {
        return node
      }

      const childrenContainer = createElement('div', 'sidebar__tree-children')
      if (!children && childLoading) {
        childrenContainer.append(createTreeMessage(t('sidebar.loading.generic')))
      } else if (childError && (!children || children.length === 0)) {
        const errorState = createElement('div', 'sidebar__tree-error')
        errorState.append(
          createTreeMessage(
            t('sidebar.error.readEntry', {
              name: entry.name,
              error: childError || t('sidebar.error.readDirectoryFallback')
            }),
            'sidebar__tree-message sidebar__tree-message--error'
          ),
          createTextButton(t('sidebar.retry'), () => {
            retryDirectoryLoad(normalizedEntryPath)
          })
        )
        childrenContainer.append(errorState)
      } else if (visibleChildren.length > 0) {
        childrenContainer.append(...visibleChildren)
      } else if (!searchActive && children && children.length === 0) {
        childrenContainer.append(createTreeMessage(t('sidebar.empty.folder')))
      }

      if (childrenContainer.childElementCount > 0) {
        node.append(childrenContainer)
      }

      return node
    }

    if (!matchesSearch(entry, query)) {
      return null
    }

    const node = createElement('div', 'sidebar__tree-node')
    const isRenaming = renamingPath === normalizedEntryPath
    const row = createElement(
      isRenaming ? 'div' : 'button',
      [
        'sidebar__tree-row',
        'sidebar__tree-row--file',
        state.activeFilePath === normalizedEntryPath ? 'sidebar__tree-row--active' : '',
        isRenaming ? 'sidebar__tree-row--renaming' : ''
      ]
        .filter(Boolean)
        .join(' ')
    )

    if (row instanceof HTMLButtonElement) {
      row.type = 'button'
    }
    row.style.setProperty('--tree-depth', String(depth))
    row.title = entry.path
    row.append(createElement('span', 'sidebar__tree-caret sidebar__tree-caret--empty'))
    row.append(createIconElement('file', 'sidebar__tree-icon sidebar__tree-icon--file'))

    if (isRenaming) {
      const input = createElement('input', 'sidebar__tree-rename') as HTMLInputElement
      input.type = 'text'
      input.value = renamingDraft
      input.spellcheck = false
      input.dataset.renamePath = normalizedEntryPath
      if (renameCommitPath === normalizedEntryPath) {
        input.disabled = true
      }
      input.addEventListener('input', () => {
        renamingDraft = input.value
      })
      input.addEventListener('click', (event) => {
        event.stopPropagation()
      })
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          void commitRename(normalizedEntryPath)
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          cancelRename()
        }
      })
      input.addEventListener('blur', () => {
        void commitRename(normalizedEntryPath)
      })
      row.append(input)
    } else {
      row.append(createElement('span', 'sidebar__tree-name', entry.name))
      row.addEventListener('click', (event) => {
        if (event.detail > 1) return
        clearPendingFileOpen()
        pendingFileOpenTimer = setTimeout(() => {
          pendingFileOpenTimer = null
          if (store.getState().activeFilePath === normalizedEntryPath) return
          void actions.openFile(normalizedEntryPath)
        }, 180)
      })
      row.addEventListener('dblclick', (event) => {
        event.preventDefault()
        clearPendingFileOpen()
        beginRename(normalizedEntryPath, entry.name)
      })
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        openContextMenu(normalizedEntryPath, entry.name, event.clientX, event.clientY)
      })
    }

    node.append(row)
    return node
  }

  const buildTree = (state: AppState, workspaceRoot: string): HTMLElement => {
    const tree = createElement('div', 'sidebar__tree')
    const rootEntries = cachedEntries.get(workspaceRoot)
    const rootError = directoryErrors.get(workspaceRoot)
    const rootLoading = loadingDirectories.has(workspaceRoot)

    if (!rootEntries && rootLoading) {
      tree.append(createTreeMessage(t('sidebar.loading.workspace')))
      return tree
    }

    if (rootError && (!rootEntries || rootEntries.length === 0)) {
      const errorState = createElement('div', 'sidebar__tree-error')
      errorState.append(
        createTreeMessage(
          t('sidebar.error.readWorkspace', {
            error: rootError || t('sidebar.error.readWorkspaceFallback')
          }),
          'sidebar__tree-message sidebar__tree-message--error'
        ),
        createTextButton(t('sidebar.retry'), refreshWorkspace)
      )
      tree.append(errorState)
      return tree
    }

    if (!rootEntries || rootEntries.length === 0) {
      tree.append(createTreeMessage(t('sidebar.noSupportedFiles')))
      return tree
    }

    const visibleNodes = rootEntries
      .map((entry) => buildEntryNode(entry, state, 0, ''))
      .filter((node): node is HTMLElement => Boolean(node))

    if (visibleNodes.length === 0) {
      tree.append(createTreeMessage(t('sidebar.noSupportedFiles')))
      return tree
    }

    tree.append(...visibleNodes)
    return tree
  }

  const buildSearchResults = (): HTMLElement => {
    const resultsPanel = createElement('div', 'sidebar__search-results')
    const query = searchQuery.trim()

    if (!query) {
      return resultsPanel
    }

    if (searchLoading) {
      resultsPanel.append(createTreeMessage(t('sidebar.loading.search')))
      return resultsPanel
    }

    if (searchError) {
      resultsPanel.append(
        createTreeMessage(
          t('sidebar.error.searchFailed', { error: searchError }),
          'sidebar__tree-message sidebar__tree-message--error'
        )
      )
      return resultsPanel
    }

    if (searchResults.length === 0) {
      resultsPanel.append(createTreeMessage(t('sidebar.search.noResults')))
      return resultsPanel
    }

    searchResults.forEach((result) => {
      const row = createElement('button', 'sidebar__search-result')
      const meta = createElement('div', 'sidebar__search-result-meta')
      const excerptText = result.excerpt
        ? result.lineNumber
          ? t('sidebar.search.lineMatch', {
              lineNumber: result.lineNumber,
              excerpt: result.excerpt
            })
          : result.excerpt
        : t('sidebar.search.fileNameMatch')

      row.type = 'button'
      row.title = result.path

      if (normalizePath(result.path) === store.getState().activeFilePath) {
        row.classList.add('sidebar__search-result--active')
      }

      row.append(
        createIconElement('file', 'sidebar__tree-icon sidebar__tree-icon--file'),
        meta
      )

      meta.append(
        createElement('div', 'sidebar__search-result-name', result.name),
        createElement('div', 'sidebar__search-result-path', result.relativePath),
        createElement('div', 'sidebar__search-result-excerpt', excerptText)
      )

      row.addEventListener('click', () => {
        void actions.openFile(normalizePath(result.path))
      })
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        openContextMenu(result.path, result.name, event.clientX, event.clientY)
      })

      resultsPanel.append(row)
    })

    return resultsPanel
  }

  const buildOutline = (state: AppState): HTMLElement => {
    const outline = createElement('div', 'sidebar__outline')

    if (!state.activeFilePath) {
      outline.append(createTreeMessage(t('sidebar.outline.openNote')))
      return outline
    }

    if (outlineState.items.length === 0) {
      outline.append(createTreeMessage(t('sidebar.outline.noHeadings')))
      return outline
    }

    outlineState.items.forEach((item) => {
      const row = createElement(
        'button',
        [
          'sidebar__outline-item',
          `sidebar__outline-item--level-${Math.min(item.level, 3)}`,
          item.id === outlineState.activeHeadingId ? 'sidebar__outline-item--active' : ''
        ]
          .filter(Boolean)
          .join(' ')
      )
      const marker = createElement('span', 'sidebar__outline-marker')
      const label = createElement('span', 'sidebar__outline-label', item.text)

      row.type = 'button'
      row.title = item.text
      row.style.setProperty('--outline-depth', String(Math.max(0, item.level - 1)))
      row.append(marker, label)
      row.addEventListener('click', () => {
        actions.jumpToOutlineHeading(item.id)
      })

      outline.append(row)
    })

    return outline
  }

  const buildContextMenu = (): HTMLElement | null => {
    if (!contextMenuState) {
      return null
    }

    const menu = createElement('div', 'sidebar__context-menu')
    const menuWidth = 184
    const menuHeight = 92
    const viewportMargin = 8
    const menuX = Math.max(
      viewportMargin,
      Math.min(contextMenuState.x, window.innerWidth - menuWidth - viewportMargin)
    )
    const menuY = Math.max(
      viewportMargin,
      Math.min(contextMenuState.y, window.innerHeight - menuHeight - viewportMargin)
    )
    const { path, name } = contextMenuState

    menu.style.left = `${menuX}px`
    menu.style.top = `${menuY}px`

    const appendMenuAction = (label: string, onClick: () => void, destructive = false): void => {
      const item = createElement(
        'button',
        destructive ? 'sidebar__menu-item sidebar__menu-item--danger' : 'sidebar__menu-item',
        label
      )
      item.type = 'button'
      item.addEventListener('click', () => {
        contextMenuState = null
        onClick()
      })
      menu.append(item)
    }

    appendMenuAction(t('sidebar.context.rename'), () => {
      beginRename(path, name)
    })
    appendMenuAction(
      t('sidebar.context.delete'),
      () => {
        render(store.getState())
        void actions.deleteFile(path).then((didDelete) => {
          if (!didDelete) {
            return
          }

          removeDeletedFileFromSidebar(path)
        })
      },
      true
    )

    return menu
  }

  const buildSidebarPanel = (state: AppState, workspaceRoot: string | null): HTMLElement => {
    const panel = createElement('section', 'sidebar__panel')
    const scroller = createElement('div', 'sidebar__scroll')
    const dragBar = createElement('div', 'sidebar__dragbar')
    dragBar.setAttribute('data-tauri-drag-region', '')

    panel.append(dragBar, createTopBar(state))

    if (state.sidebarTab === 'files' && workspaceRoot) {
      panel.append(createSearchBar())
    }

    if (state.sidebarTab === 'outline') {
      scroller.append(buildOutline(state))
    } else if (workspaceRoot) {
      scroller.append(
        searchQuery.trim().length > 0 ? buildSearchResults() : buildTree(state, workspaceRoot)
      )
    } else {
      scroller.append(createEmptyState())
    }

    panel.append(scroller, createBottomBar(state, workspaceRoot))

    const contextMenu = buildContextMenu()
    if (contextMenu) {
      panel.append(contextMenu)
    }

    return panel
  }

  const render = (state: AppState): void => {
    if (destroyed) return

    const workspaceRoot = state.workspaceRoot ? normalizePath(state.workspaceRoot) : null
    const activeElement = document.activeElement
    const shouldRestoreSearchFocus =
      state.sidebarTab === 'files' &&
      activeElement instanceof HTMLInputElement &&
      activeElement.id === 'sidebar-search-input'

    if (shouldRestoreSearchFocus) {
      searchSelectionStart = activeElement.selectionStart
      searchSelectionEnd = activeElement.selectionEnd
    }

    if (workspaceRoot !== currentWorkspaceRoot) {
      currentWorkspaceRoot = workspaceRoot
      resetWorkspaceState()
      resetSearchResults()
      moreMenuOpen = false
      clearPendingFileOpen()
      renamingPath = null
      renamingDraft = ''
      renameCommitPath = null
      renameFocusPath = null
      contextMenuState = null
      if (!workspaceRoot) {
        searchQuery = ''
      }
    }

    if (workspaceRoot) {
      ensureDirectoryLoaded(workspaceRoot)
      state.expandedDirs
        .map((directoryPath) => normalizePath(directoryPath))
        .filter((directoryPath) => isPathWithinRoot(workspaceRoot, directoryPath))
        .forEach((directoryPath) => ensureDirectoryLoaded(directoryPath))

      if (state.sidebarTab === 'files' && searchQuery.trim().length > 0) {
        const nextSearchKey = `${workspaceRoot}::${searchQuery.trim().toLowerCase()}`
        if (lastSearchKey !== nextSearchKey) {
          scheduleWorkspaceSearch(workspaceRoot, searchQuery)
          return
        }
      }
    } else {
      moreMenuOpen = false
      contextMenuState = null
    }

    if (state.sidebarTab !== 'files') {
      contextMenuState = null
    }

    sidebarBody.replaceChildren(buildSidebarPanel(state, workspaceRoot))

    if (state.sidebarTab === 'files' && (searchFocusPending || shouldRestoreSearchFocus)) {
      focusSearchInput()
      searchFocusPending = false
    }

    const pendingRenamePath = renameFocusPath
    if (pendingRenamePath) {
      requestAnimationFrame(() => {
        if (destroyed || renameFocusPath !== pendingRenamePath) return
        const selector = `.sidebar__tree-rename[data-rename-path="${CSS.escape(pendingRenamePath)}"]`
        const input = sidebarBody.querySelector(selector) as HTMLInputElement | null
        if (!input) return
        input.focus()
        input.setSelectionRange(0, getRenameSelectionEnd(input.value))
        renameFocusPath = null
      })
    }
  }

  const handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (target?.closest('.sidebar__context-menu')) {
      return
    }

    if (contextMenuState) {
      contextMenuState = null
      render(store.getState())
      return
    }

    if (!moreMenuOpen) return

    if (target?.closest('.sidebar__menu-wrap')) {
      return
    }

    moreMenuOpen = false
    render(store.getState())
  }

  const handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (renamingPath) {
      cancelRename()
      return
    }
    if (contextMenuState) {
      contextMenuState = null
      render(store.getState())
      return
    }
    if (!moreMenuOpen && searchQuery.length === 0 && !contextMenuState) return
    closeTransientUI()
  }

  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleDocumentKeydown)

  const unsubscribe = store.subscribe((state) => render(state))
  render(store.getState())

  return {
    refresh: refreshWorkspace,
    setOutlineState: (nextOutlineState) => {
      outlineState = nextOutlineState
      render(store.getState())
    },
    destroy: () => {
      destroyed = true
      clearPendingFileOpen()
      clearSearchTimer()
      unsubscribe()
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleDocumentKeydown)
    }
  }
}
