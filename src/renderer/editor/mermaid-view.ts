import mermaid from 'mermaid'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import {
  subscribeRendererLanguageChange,
  translateCurrentRenderer
} from '../i18n'

let mermaidSequence = 0

function getCodeBlockLanguage(node: ProseNode): string {
  return String(node.attrs.language ?? '').trim().toLowerCase()
}

function isMermaidBlock(node: ProseNode): boolean {
  return getCodeBlockLanguage(node) === 'mermaid'
}

function applyCodeBlockLanguage(dom: HTMLElement, language: string): void {
  if (language) {
    dom.dataset.language = language
    return
  }

  delete dom.dataset.language
}

function initializeMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.body.classList.contains('ui-theme-dark') ? 'dark' : 'default',
    fontFamily:
      '"SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14
  })
}

function normalizeMermaidSource(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

function autoResize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = '0px'
  textarea.style.height = `${Math.max(textarea.scrollHeight, 112)}px`
}

function createPlainCodeBlockView(node: ProseNode): ReturnType<NodeViewConstructor> {
  let currentNode = node
  const dom = document.createElement('pre')
  const code = document.createElement('code')

  applyCodeBlockLanguage(dom, getCodeBlockLanguage(currentNode))
  dom.append(code)

  return {
    dom,
    contentDOM: code,
    update(nextNode) {
      if (nextNode.type !== currentNode.type || isMermaidBlock(nextNode)) {
        return false
      }

      currentNode = nextNode
      applyCodeBlockLanguage(dom, getCodeBlockLanguage(currentNode))
      return true
    }
  }
}

function createMermaidBlockView(): NodeViewConstructor {
  return (initialNode, view, getPos) => {
    let currentNode = initialNode
    let renderVersion = 0
    let destroyed = false
    let isEditing = false
    let isSelected = false
    let isApplyingLocalInput = false

    const dom = document.createElement('div')
    dom.className = 'milkdown-mermaid-block milkdown-mermaid-block-node'

    const editorWrap = document.createElement('div')
    editorWrap.className = 'milkdown-mermaid-editor'

    const editorLabel = document.createElement('div')
    editorLabel.className = 'milkdown-mermaid-editor-label'

    const textarea = document.createElement('textarea')
    textarea.className = 'milkdown-mermaid-textarea'
    textarea.spellcheck = false

    editorWrap.append(editorLabel, textarea)

    const preview = document.createElement('div')
    preview.className = 'milkdown-mermaid-preview'

    const fallback = document.createElement('pre')
    fallback.className = 'milkdown-mermaid-fallback'

    const fallbackCode = document.createElement('code')
    fallback.append(fallbackCode)

    const syncCopy = (): void => {
      editorLabel.textContent = translateCurrentRenderer('mermaid.label')
      textarea.placeholder = translateCurrentRenderer('mermaid.placeholder')
    }

    const syncUiState = (): void => {
      dom.classList.toggle('is-editing', isEditing)
      dom.classList.toggle('selected', isSelected)
    }

    const renderDiagram = async (nextSource = currentNode.textContent): Promise<void> => {
      const source = normalizeMermaidSource(nextSource)
      const nextRenderVersion = ++renderVersion

      preview.classList.add('milkdown-mermaid-preview--loading')
      preview.innerHTML = ''
      fallback.style.display = 'none'

      if (!source.trim()) {
        preview.classList.remove('milkdown-mermaid-preview--loading')
        preview.textContent = translateCurrentRenderer('mermaid.empty')
        return
      }

      try {
        initializeMermaid()
        const renderId = `colamd-mermaid-${++mermaidSequence}`
        const { svg, bindFunctions } = await mermaid.render(renderId, source)

        if (destroyed || nextRenderVersion !== renderVersion) {
          return
        }

        preview.innerHTML = svg
        bindFunctions?.(preview)
      } catch (error) {
        if (destroyed || nextRenderVersion !== renderVersion) {
          return
        }

        preview.innerHTML = ''
        fallback.style.display = 'block'
        fallbackCode.textContent = translateCurrentRenderer('mermaid.renderFailed', {
          message: error instanceof Error ? error.message : String(error),
          source
        })
      } finally {
        if (!destroyed && nextRenderVersion === renderVersion) {
          preview.classList.remove('milkdown-mermaid-preview--loading')
        }
      }
    }

    const bindNode = (node: ProseNode): void => {
      currentNode = node
      const source = normalizeMermaidSource(node.textContent)

      if (!isEditing || !isApplyingLocalInput) {
        textarea.value = source
        autoResize(textarea)
        void renderDiagram(source)
      }
    }

    const dispatchSource = (nextSource: string): void => {
      if (!view.editable) return

      const pos = getPos()
      if (pos == null) return

      const normalizedSource = normalizeMermaidSource(nextSource)
      if (normalizedSource === normalizeMermaidSource(currentNode.textContent)) {
        return
      }

      const from = pos + 1
      const to = pos + currentNode.nodeSize - 1

      isApplyingLocalInput = true
      try {
        const tr = view.state.tr

        if (normalizedSource) {
          view.dispatch(tr.insertText(normalizedSource, from, to))
        } else {
          view.dispatch(tr.delete(from, to))
        }
      } finally {
        isApplyingLocalInput = false
      }
    }

    const enterEditing = (): void => {
      if (!view.editable || isEditing) return

      isEditing = true
      syncUiState()
      textarea.value = normalizeMermaidSource(currentNode.textContent)
      autoResize(textarea)

      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      })
    }

    const exitEditing = (): void => {
      if (!isEditing) return

      isEditing = false
      syncUiState()
      void renderDiagram(textarea.value)
    }

    preview.addEventListener('click', () => {
      enterEditing()
    })

    fallback.addEventListener('click', () => {
      enterEditing()
    })

    textarea.addEventListener('input', () => {
      const source = textarea.value
      autoResize(textarea)
      void renderDiagram(source)
      dispatchSource(source)
    })

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        exitEditing()
        view.focus()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        exitEditing()
        view.focus()
      }
    })

    textarea.addEventListener('focusout', () => {
      requestAnimationFrame(() => {
        if (dom.contains(document.activeElement)) {
          return
        }

        exitEditing()
      })
    })

    dom.append(editorWrap, preview, fallback)
    bindNode(initialNode)
    syncCopy()
    syncUiState()
    const unsubscribeLanguage = subscribeRendererLanguageChange(() => {
      syncCopy()
      void renderDiagram(textarea.value)
    })

    return {
      dom,
      update(nextNode) {
        if (nextNode.type !== currentNode.type || !isMermaidBlock(nextNode)) {
          return false
        }

        bindNode(nextNode)
        return true
      },
      stopEvent(event) {
        return event.target instanceof HTMLTextAreaElement
      },
      ignoreMutation() {
        return true
      },
      destroy() {
        destroyed = true
        unsubscribeLanguage()
      },
      selectNode() {
        isSelected = true
        syncUiState()
      },
      deselectNode() {
        isSelected = false

        if (!isEditing) {
          syncUiState()
          return
        }

        requestAnimationFrame(() => {
          if (dom.contains(document.activeElement)) {
            return
          }

          exitEditing()
          syncUiState()
        })
      }
    }
  }
}

export const mermaidView = $view(codeBlockSchema.node, (): NodeViewConstructor => {
  const mermaidBlockView = createMermaidBlockView()

  return (node, view, getPos) => {
    return isMermaidBlock(node)
      ? mermaidBlockView(node, view, getPos)
      : createPlainCodeBlockView(node)
  }
})
