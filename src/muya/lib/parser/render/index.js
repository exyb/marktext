import loadRenderer from '../../renderers'
import { CLASS_OR_ID, PREVIEW_DOMPURIFY_CONFIG } from '../../config'
import { conflict, mixins, camelToSnake, sanitize } from '../../utils'
import { patch, toVNode, toHTML, h } from './snabbdom'
import { beginRules } from '../rules'
import renderInlines from './renderInlines'
import renderBlock from './renderBlock'

class StateRender {
  constructor(muya) {
    this.muya = muya
    this.eventCenter = muya.eventCenter
    this.codeCache = new Map()
    this.loadImageMap = new Map()
    this.loadMathMap = new Map()
    this.mermaidCache = new Map()
    this.diagramCache = new Map()
    this.tokenCache = new Map()
    this.labels = new Map()
    this.urlMap = new Map()
    this.renderingTable = null
    this.renderingRowContainer = null
    this.container = null
  }

  setContainer(container) {
    this.container = container
  }

  // collect link reference definition
  collectLabels(blocks) {
    this.labels.clear()

    const travel = (block) => {
      const { text, children } = block
      if (children && children.length) {
        children.forEach((c) => travel(c))
      } else if (text) {
        const tokens = beginRules.reference_definition.exec(text)
        if (tokens) {
          const key = (tokens[2] + tokens[3]).toLowerCase()
          if (!this.labels.has(key)) {
            this.labels.set(key, {
              href: tokens[6],
              title: tokens[10] || ''
            })
          }
        }
      }
    }

    blocks.forEach((b) => travel(b))
  }

  checkConflicted(block, token, cursor) {
    const { start, end } = cursor
    const key = block.key
    const { start: tokenStart, end: tokenEnd } = token.range

    if (key !== start.key && key !== end.key) {
      return false
    } else if (key === start.key && key !== end.key) {
      return conflict([tokenStart, tokenEnd], [start.offset, start.offset])
    } else if (key !== start.key && key === end.key) {
      return conflict([tokenStart, tokenEnd], [end.offset, end.offset])
    } else {
      return (
        conflict([tokenStart, tokenEnd], [start.offset, start.offset]) ||
        conflict([tokenStart, tokenEnd], [end.offset, end.offset])
      )
    }
  }

  getClassName(outerClass, block, token, cursor) {
    return (
      outerClass ||
      (this.checkConflicted(block, token, cursor) ? CLASS_OR_ID.AG_GRAY : CLASS_OR_ID.AG_HIDE)
    )
  }

  getHighlightClassName(active) {
    return active ? CLASS_OR_ID.AG_HIGHLIGHT : CLASS_OR_ID.AG_SELECTION
  }

  getSelector(block, activeBlocks) {
    const { cursor, selectedBlock } = this.muya.contentState
    const type = block.type === 'hr' ? 'p' : block.type
    const isActive = activeBlocks.some((b) => b.key === block.key) || block.key === cursor.start.key

    let selector = `${type}#${block.key}.${CLASS_OR_ID.AG_PARAGRAPH}`
    if (isActive) {
      selector += `.${CLASS_OR_ID.AG_ACTIVE}`
    }
    if (type === 'span') {
      selector += `.ag-${camelToSnake(block.functionType)}`
    }
    if (!block.parent && selectedBlock && block.key === selectedBlock.key) {
      selector += `.${CLASS_OR_ID.AG_SELECTED}`
    }
    return selector
  }

  async renderMermaid() {
    if (this.mermaidCache.size) {
      const mermaid = await loadRenderer('mermaid')
      // Mermaid v11 初始化配置
      mermaid.initialize({
        securityLevel: 'loose',
        theme: this.muya.options.mermaidTheme,
        startOnLoad: false
      })
      for (const [key, value] of this.mermaidCache.entries()) {
        const { code } = value
        const target = document.querySelector(key)
        if (!target) {
          continue
        }
        try {
          // Mermaid v11 使用异步 parse
          await mermaid.parse(code)
          target.innerHTML = sanitize(code, PREVIEW_DOMPURIFY_CONFIG, true)
          // Mermaid v11 使用 run() 替代 init()
          await mermaid.run({
            nodes: [target]
          })
          // 添加缩放和拖拽功能
          this.addMermaidControls(target)
        } catch (err) {
          console.error('Mermaid rendering error:', err)
          target.innerHTML = '< Invalid Mermaid Codes >'
          target.classList.add(CLASS_OR_ID.AG_MATH_ERROR)
        }
      }

      this.mermaidCache.clear()
    }
  }

  /**
   * 为 Mermaid 图表添加缩放和拖拽控制
   * @param {HTMLElement} container - Mermaid 图表容器
   */
  addMermaidControls(container) {
    // 创建控制面板
    const controls = document.createElement('div')
    controls.className = 'mermaid-controls'
    controls.innerHTML = `
      <button class="mermaid-btn mermaid-zoom-in" title="放大">+</button>
      <button class="mermaid-btn mermaid-zoom-out" title="缩小">-</button>
      <button class="mermaid-btn mermaid-zoom-reset" title="重置">⟲</button>
    `

    // 将图表内容包裹在一个可缩放的容器中
    const svg = container.querySelector('svg')
    if (!svg) return

    const wrapper = document.createElement('div')
    wrapper.className = 'mermaid-wrapper'
    wrapper.style.cssText = `
      overflow: auto;
      position: relative;
      width: 100%;
      height: 100%;
      cursor: grab;
    `

    // 包裹 SVG
    container.insertBefore(wrapper, container.firstChild)
    wrapper.appendChild(svg)
    container.appendChild(controls)

    // 缩放状态
    let scale = 1
    let isDragging = false
    let startX = 0
    let startY = 0
    let translateX = 0
    let translateY = 0

    // 更新变换
    const updateTransform = () => {
      svg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`
      svg.style.transformOrigin = 'top left'
    }

    // 放大
    controls.querySelector('.mermaid-zoom-in').addEventListener('click', () => {
      scale = Math.min(scale * 1.2, 5)
      updateTransform()
    })

    // 缩小
    controls.querySelector('.mermaid-zoom-out').addEventListener('click', () => {
      scale = Math.max(scale / 1.2, 0.2)
      updateTransform()
    })

    // 重置
    controls.querySelector('.mermaid-zoom-reset').addEventListener('click', () => {
      scale = 1
      translateX = 0
      translateY = 0
      updateTransform()
    })

    // 鼠标拖拽
    wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return // 只响应左键
      isDragging = true
      startX = e.clientX - translateX
      startY = e.clientY - translateY
      wrapper.style.cursor = 'grabbing'
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      translateX = e.clientX - startX
      translateY = e.clientY - startY
      updateTransform()
    })

    document.addEventListener('mouseup', () => {
      isDragging = false
      wrapper.style.cursor = 'grab'
    })

    // 鼠标滚轮缩放
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      scale = Math.max(0.2, Math.min(5, scale * delta))
      updateTransform()
    })
  }

  async renderDiagram() {
    const cache = this.diagramCache
    if (cache.size) {
      const RENDER_MAP = {
        flowchart: await loadRenderer('flowchart'),
        sequence: await loadRenderer('sequence'),
        plantuml: await loadRenderer('plantuml'),
        'vega-lite': await loadRenderer('vega-lite')
      }

      for (const [key, value] of cache.entries()) {
        const target = document.querySelector(key)
        if (!target) {
          continue
        }
        const { code, functionType } = value
        const render = RENDER_MAP[functionType]
        const options = {}
        if (functionType === 'sequence') {
          Object.assign(options, { theme: this.muya.options.sequenceTheme })
        } else if (functionType === 'vega-lite') {
          Object.assign(options, {
            actions: false,
            tooltip: false,
            renderer: 'svg',
            theme: this.muya.options.vegaTheme
          })
        }
        try {
          if (functionType === 'flowchart' || functionType === 'sequence') {
            const diagram = render.parse(code)
            target.innerHTML = ''
            diagram.drawSVG(target, options)
          } else if (functionType === 'plantuml') {
            const diagram = render.parse(code)
            target.innerHTML = ''
            diagram.insertImgElement(target)
          } else if (functionType === 'vega-lite') {
            await render(key, JSON.parse(code), options)
          }
        } catch (err) {
          target.innerHTML = `< Invalid ${functionType === 'flowchart' ? 'Flow Chart' : 'Sequence'} Codes >`
          target.classList.add(CLASS_OR_ID.AG_MATH_ERROR)
        }
      }
      this.diagramCache.clear()
    }
  }

  render(blocks, activeBlocks, matches) {
    const selector = `div#${CLASS_OR_ID.AG_EDITOR_ID}`
    const t = this.muya.options.t || ((key) => key) // Get the translation function, falling back to returning the key itself if absent
    const children = blocks.map((block) => {
      return this.renderBlock(null, block, activeBlocks, matches, true, t)
    })
    const newVdom = h(selector, children)
    const rootDom = document.querySelector(selector) || this.container
    const oldVdom = toVNode(rootDom)

    patch(oldVdom, newVdom)
    this.renderMermaid()
    this.renderDiagram()
    this.codeCache.clear()
  }

  // Only render the blocks which you updated
  partialRender(blocks, activeBlocks, matches, startKey, endKey) {
    const cursorOutMostBlock = activeBlocks[activeBlocks.length - 1]
    // If cursor is not in render blocks, need to render cursor block independently
    const needRenderCursorBlock = blocks.indexOf(cursorOutMostBlock) === -1
    const t = this.muya.options.t || ((key) => key) // Get the translation function, falling back to returning the key itself if absent
    const newVnode = h(
      'section',
      blocks.map((block) => this.renderBlock(null, block, activeBlocks, matches, false, t))
    )
    const html = toHTML(newVnode).replace(/^<section>([\s\S]+?)<\/section>$/, '$1')

    const needToRemoved = []
    const firstOldDom = startKey
      ? document.querySelector(`#${startKey}`)
      : document.querySelector(`div#${CLASS_OR_ID.AG_EDITOR_ID}`).firstElementChild
    if (!firstOldDom) {
      // TODO@Jocs Just for fix #541, Because I'll rewrite block and render method, it will nolonger have this issue.
      return
    }
    needToRemoved.push(firstOldDom)
    let nextSibling = firstOldDom.nextElementSibling
    while (nextSibling && nextSibling.id !== endKey) {
      needToRemoved.push(nextSibling)
      nextSibling = nextSibling.nextElementSibling
    }
    nextSibling && needToRemoved.push(nextSibling)

    firstOldDom.insertAdjacentHTML('beforebegin', html)

    Array.from(needToRemoved).forEach((dom) => dom.remove())

    // Render cursor block independently
    if (needRenderCursorBlock) {
      const { key } = cursorOutMostBlock
      const cursorDom = document.querySelector(`#${key}`)
      if (cursorDom) {
        const oldCursorVnode = toVNode(cursorDom)
        const newCursorVnode = this.renderBlock(
          null,
          cursorOutMostBlock,
          activeBlocks,
          matches,
          false,
          t
        )
        patch(oldCursorVnode, newCursorVnode)
      }
    }

    this.renderMermaid()
    this.renderDiagram()
    this.codeCache.clear()
  }

  /**
   * Only render one block.
   *
   * @param {object} block
   * @param {array} activeBlocks
   * @param {array} matches
   */
  singleRender(block, activeBlocks, matches) {
    const selector = `#${block.key}`
    const t = this.muya.options.t || ((key) => key) // Get the translation function, falling back to returning the key itself if absent
    const newVdom = this.renderBlock(null, block, activeBlocks, matches, true, t)
    const rootDom = document.querySelector(selector)
    const oldVdom = toVNode(rootDom)
    patch(oldVdom, newVdom)
    this.renderMermaid()
    this.renderDiagram()
    this.codeCache.clear()
  }

  invalidateImageCache() {
    this.loadImageMap.forEach((imageInfo, key) => {
      imageInfo.touchMsec = Date.now()
      this.loadImageMap.set(key, imageInfo)
    })
  }
}

mixins(StateRender, renderInlines, renderBlock)

export default StateRender
