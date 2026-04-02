import { $view } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'

export const htmlView = $view(htmlSchema.node, (): NodeViewConstructor => {
  return (node) => {
    const dom = document.createElement('span')
    dom.classList.add('milkdown-html-inline')
    dom.textContent = String(node.attrs.value ?? '')
    dom.style.whiteSpace = 'pre-wrap'
    dom.style.fontFamily = 'monospace'
    return {
      dom,
      ignoreMutation: () => true,
      stopEvent: () => true
    }
  }
})
