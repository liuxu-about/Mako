import { mathBlockSchema } from './math'
import { katexOptionsCtx, renderKatex } from './math'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import {
  subscribeRendererLanguageChange,
  translateCurrentRenderer
} from '../i18n'

function getMathBlockValue(node: ProseNode): string {
  return String(node.attrs.value ?? '')
}

function autoResize(textarea: HTMLTextAreaElement): void {
  textarea.style.height = '0px'
  textarea.style.height = `${Math.max(textarea.scrollHeight, 96)}px`
}

export const mathBlockView = $view(mathBlockSchema.node, (ctx): NodeViewConstructor => {
  return (initialNode, view, getPos) => {
    let currentNode = initialNode
    let isEditing = false
    let isSelected = false
    let isApplyingLocalInput = false

    const dom = document.createElement('div')
    dom.className = 'milkdown-math-block milkdown-math-block-node'

    const editorWrap = document.createElement('div')
    editorWrap.className = 'milkdown-math-block-editor'

    const editorLabel = document.createElement('div')
    editorLabel.className = 'milkdown-math-block-editor-label'

    const textarea = document.createElement('textarea')
    textarea.className = 'milkdown-math-block-textarea'
    textarea.spellcheck = false

    editorWrap.append(editorLabel, textarea)

    const preview = document.createElement('div')
    preview.className = 'milkdown-math-block-preview'

    const renderPreview = (value: string): void => {
      preview.innerHTML = ''
      if (!value.trim()) {
        preview.textContent = translateCurrentRenderer('math.empty')
        preview.classList.add('milkdown-math-block-preview--empty')
        return
      }

      preview.classList.remove('milkdown-math-block-preview--empty')
      renderKatex(value, preview, ctx.get(katexOptionsCtx.key), true)
    }

    const syncCopy = (): void => {
      editorLabel.textContent = translateCurrentRenderer('math.label')
      textarea.placeholder = translateCurrentRenderer('math.placeholder')
    }

    const syncUiState = (): void => {
      dom.classList.toggle('is-editing', isEditing)
      dom.classList.toggle('selected', isSelected)
    }

    const bindNode = (node: ProseNode): void => {
      currentNode = node
      const value = getMathBlockValue(node)

      if (!isEditing || !isApplyingLocalInput) {
        textarea.value = value
        autoResize(textarea)
        renderPreview(value)
      }
    }

    const dispatchValue = (nextValue: string): void => {
      if (!view.editable) return

      const pos = getPos()
      if (pos == null) return

      if (nextValue === getMathBlockValue(currentNode)) {
        return
      }

      isApplyingLocalInput = true
      try {
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'value', nextValue))
      } finally {
        isApplyingLocalInput = false
      }
    }

    const enterEditing = (): void => {
      if (!view.editable || isEditing) return

      isEditing = true
      syncUiState()
      textarea.value = getMathBlockValue(currentNode)
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
      renderPreview(textarea.value)
    }

    preview.addEventListener('click', () => {
      enterEditing()
    })

    textarea.addEventListener('input', () => {
      const value = textarea.value
      autoResize(textarea)
      renderPreview(value)
      dispatchValue(value)
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

    dom.append(editorWrap, preview)
    bindNode(initialNode)
    syncCopy()
    syncUiState()
    const unsubscribeLanguage = subscribeRendererLanguageChange(() => {
      syncCopy()
      renderPreview(textarea.value)
    })

    return {
      dom,
      update(nextNode) {
        if (nextNode.type !== currentNode.type) {
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
})
