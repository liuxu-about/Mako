import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { replaceAll } from '@milkdown/kit/utils'
import { htmlView } from './html-view'
import { translateCurrentRenderer } from '../i18n'
import { mathBlockView } from './math-view'
import { mermaidView } from './mermaid-view'
import { katexOptionsCtx, math } from './math'

import '@milkdown/kit/prose/view/style/prosemirror.css'
import 'katex/dist/katex.min.css'

let editorInstance: Editor | null = null
let outlineState: EditorOutlineState = {
  items: [],
  activeHeadingId: null
}
const outlineListeners = new Set<(state: EditorOutlineState) => void>()

function getDefaultContent(): string {
  return `# ${translateCurrentRenderer('editor.defaultContentTitle')}

${translateCurrentRenderer('editor.defaultContentBody')}
`
}

export interface EditorOutlineItem {
  id: string
  level: number
  text: string
  pos: number
}

export interface EditorOutlineState {
  items: EditorOutlineItem[]
  activeHeadingId: string | null
}

function buildOutlineItems(doc: ProseNode): EditorOutlineItem[] {
  const items: EditorOutlineItem[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') {
      return
    }

    const level = Number(node.attrs.level ?? 0)
    if (!Number.isFinite(level) || level < 1 || level > 3) {
      return
    }

    const text = node.textContent.replace(/\s+/g, ' ').trim()
    if (!text) {
      return
    }

    items.push({
      id: `heading-${pos}`,
      level,
      text,
      pos
    })
  })

  return items
}

function getActiveHeadingId(items: EditorOutlineItem[], selectionFrom: number): string | null {
  let activeHeadingId: string | null = null

  for (const item of items) {
    if (item.pos > selectionFrom) {
      break
    }

    activeHeadingId = item.id
  }

  return activeHeadingId
}

function emitOutlineState(nextState: EditorOutlineState): void {
  outlineState = nextState
  outlineListeners.forEach((listener) => listener(outlineState))
}

function syncOutlineState(doc: ProseNode, selectionFrom: number): void {
  const items = buildOutlineItems(doc)
  emitOutlineState({
    items,
    activeHeadingId: getActiveHeadingId(items, selectionFrom)
  })
}

export async function createEditor(
  rootId: string,
  onChange?: (markdown: string) => void
): Promise<Editor> {
  const root = document.getElementById(rootId)
  if (!root) throw new Error(`Element #${rootId} not found`)

  editorInstance = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, getDefaultContent())
      ctx.set(katexOptionsCtx.key, {
        throwOnError: false,
        strict: 'ignore',
        output: 'htmlAndMathml'
      })
      const listeners = ctx.get(listenerCtx)
      if (onChange) {
        listeners.markdownUpdated((_ctx, markdown) => {
          onChange(markdown)
        })
      }
      listeners.updated((_ctx, doc) => {
        const view = ctx.get(editorViewCtx)
        syncOutlineState(doc, view.state.selection.from)
      })
      listeners.selectionUpdated((_ctx, selection) => {
        emitOutlineState({
          items: outlineState.items,
          activeHeadingId: getActiveHeadingId(outlineState.items, selection.from)
        })
      })
      listeners.mounted((_ctx) => {
        const view = ctx.get(editorViewCtx)
        syncOutlineState(view.state.doc, view.state.selection.from)
      })
    })
    .use(commonmark)
    .use(gfm)
    .use(math)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(htmlView)
    .use(mathBlockView)
    .use(mermaidView)
    .create()

  return editorInstance
}

export function subscribeEditorOutline(
  listener: (state: EditorOutlineState) => void
): () => void {
  outlineListeners.add(listener)
  listener(outlineState)

  return () => {
    outlineListeners.delete(listener)
  }
}

export function jumpToOutlineHeading(headingId: string): void {
  if (!editorInstance) return

  const target = outlineState.items.find((item) => item.id === headingId)
  if (!target) return

  editorInstance.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const resolvedPos = view.state.doc.resolve(Math.min(target.pos + 1, view.state.doc.content.size))
    const selection = TextSelection.near(resolvedPos)
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
    view.focus()
  })
}

export function getMarkdown(): string {
  if (!editorInstance) return ''
  let markdown = ''
  editorInstance.action((ctx) => {
    const serializer = ctx.get(serializerCtx)
    const view = ctx.get(editorViewCtx)
    markdown = serializer(view.state.doc)
  })
  return markdown
}

export function setMarkdown(content: string): void {
  if (!editorInstance) return
  editorInstance.action(replaceAll(content))
}
