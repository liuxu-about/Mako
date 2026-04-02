import type { Meta, MilkdownPlugin } from '@milkdown/ctx'
import { expectDomTypeError } from '@milkdown/exception'
import { nodeRule } from '@milkdown/prose'
import { InputRule } from '@milkdown/prose/inputrules'
import { Fragment } from '@milkdown/prose/model'
import { $ctx, $inputRule, $nodeSchema, $remark } from '@milkdown/utils'
import type { KatexOptions } from 'katex'
import katex from 'katex'
import remarkMath from 'remark-math'

function withMeta<T extends MilkdownPlugin>(
  plugin: T,
  meta: Partial<Meta> & Pick<Meta, 'displayName'>
): T {
  Object.assign(plugin, {
    meta: {
      package: 'colamd/local-math',
      ...meta
    }
  })

  return plugin
}

export function renderKatex(
  tex: string,
  element: HTMLElement,
  options: KatexOptions,
  displayMode: boolean
): void {
  try {
    katex.render(tex, element, {
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
      ...options,
      displayMode
    })
  } catch {
    element.textContent = tex
  }
}

export const remarkMathPlugin = $remark<'remarkMath', undefined>('remarkMath', () => remarkMath)

withMeta(remarkMathPlugin.plugin, {
  displayName: 'Remark<remarkMath>'
})

withMeta(remarkMathPlugin.options, {
  displayName: 'RemarkConfig<remarkMath>'
})

export const katexOptionsCtx = $ctx<KatexOptions, 'katexOptions'>({}, 'katexOptions')

withMeta(katexOptionsCtx, {
  displayName: 'Ctx<katexOptions>'
})

const mathInlineId = 'math_inline'
const mathBlockId = 'math_block'

export const mathInlineSchema = $nodeSchema(mathInlineId, (ctx) => ({
  group: 'inline',
  content: 'text*',
  inline: true,
  atom: true,
  parseDOM: [
    {
      tag: `span[data-type="${mathInlineId}"]`,
      getContent: (dom, schema) => {
        if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom)

        return Fragment.from(schema.text(dom.dataset.value ?? ''))
      }
    }
  ],
  toDOM: (node) => {
    const dom = document.createElement('span')
    dom.classList.add('milkdown-math-inline')
    dom.dataset.type = mathInlineId
    dom.dataset.value = node.textContent
    renderKatex(node.textContent, dom, ctx.get(katexOptionsCtx.key), false)
    return dom
  },
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state
        .openNode(type)
        .addText(node.value as string)
        .closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === mathInlineId,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.textContent)
    }
  }
}))

withMeta(mathInlineSchema.ctx, {
  displayName: 'NodeSchemaCtx<mathInline>'
})

withMeta(mathInlineSchema.node, {
  displayName: 'NodeSchema<mathInline>'
})

export const mathInlineInputRule = $inputRule((ctx) =>
  nodeRule(/(?:\$)([^$]+)(?:\$)$/, mathInlineSchema.type(ctx), {
    beforeDispatch: ({ tr, match, start }) => {
      tr.insertText(match[1] ?? '', start + 1)
    }
  })
)

withMeta(mathInlineInputRule, {
  displayName: 'InputRule<mathInline>'
})

export const mathBlockSchema = $nodeSchema(mathBlockId, (ctx) => ({
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  atom: true,
  isolating: true,
  attrs: {
    value: {
      default: ''
    }
  },
  parseDOM: [
    {
      tag: `div[data-type="${mathBlockId}"]`,
      preserveWhitespace: 'full',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom)
        return { value: dom.dataset.value ?? '' }
      }
    }
  ],
  toDOM: (node) => {
    const dom = document.createElement('div')
    dom.classList.add('milkdown-math-block')
    dom.dataset.type = mathBlockId
    dom.dataset.value = String(node.attrs.value ?? '')
    renderKatex(dom.dataset.value, dom, ctx.get(katexOptionsCtx.key), true)
    return dom
  },
  parseMarkdown: {
    match: ({ type }) => type === 'math',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string })
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === mathBlockId,
    runner: (state, node) => {
      state.addNode('math', undefined, node.attrs.value)
    }
  }
}))

withMeta(mathBlockSchema.ctx, {
  displayName: 'NodeSchemaCtx<mathBlock>'
})

withMeta(mathBlockSchema.node, {
  displayName: 'NodeSchema<mathBlock>'
})

export const mathBlockInputRule = $inputRule(
  (ctx) =>
    new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
      const $start = state.doc.resolve(start)
      if (
        !$start
          .node(-1)
          .canReplaceWith($start.index(-1), $start.indexAfter(-1), mathBlockSchema.type(ctx))
      ) {
        return null
      }

      return state.tr.delete(start, end).setBlockType(start, start, mathBlockSchema.type(ctx))
    })
)

withMeta(mathBlockInputRule, {
  displayName: 'InputRule<mathBlock>'
})

export const math: MilkdownPlugin[] = [
  remarkMathPlugin,
  katexOptionsCtx,
  mathInlineSchema,
  mathBlockSchema,
  mathBlockInputRule,
  mathInlineInputRule
].flat()
