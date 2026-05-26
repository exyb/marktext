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
    // 用于跟踪是否已经添加了全局事件监听器
    this.diagramEventListenersAdded = false
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
          // 保存当前的 transform 状态（从 container 的 dataset 中读取）
          let savedTransform = target.dataset.diagramTransform || null
          
          // 如果 dataset 中没有，尝试从现有的 wrapper 中读取
          if (!savedTransform) {
            const existingWrapper = target.querySelector('.mermaid-wrapper')
            const existingScalable = existingWrapper?.querySelector('svg')
            if (existingScalable && existingScalable.style.transform) {
              savedTransform = existingScalable.style.transform
            }
          }

          // Mermaid v11 使用异步 parse
          await mermaid.parse(code)
          target.innerHTML = sanitize(code, PREVIEW_DOMPURIFY_CONFIG, true)

          // 等待 DOM 更新完成后再渲染 Mermaid
          await new Promise((resolve) => window.requestAnimationFrame(resolve))

          // Mermaid v11 使用 run() 替代 init()
          await mermaid.run({
            nodes: [target]
          })
          
          // 如果有保存的 transform，立即应用（在 addMermaidControls 之前）
          if (savedTransform) {
            const scalableElement = target.querySelector('svg')
            if (scalableElement) {
              scalableElement.style.transform = savedTransform
              scalableElement.style.transformOrigin = 'top left'
              target.classList.add('diagram-focused')
            }
          }
          
          // 添加缩放和拖拽功能，并传入保存的状态
          this.addMermaidControls(target, savedTransform)
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
   * @param {string|null} savedTransform - 之前保存的 transform 状态
   */
  addMermaidControls(container, savedTransform = null) {
    this.addDiagramControls(container, 'Mermaid', savedTransform)
  }

  /**
   * 为图表(Mermaid/PlantUML等)添加缩放、拖拽和调整大小控制
   * @param {HTMLElement} container - 图表容器
   * @param {string} diagramType - 图表类型 ('Mermaid' | 'PlantUML')
   * @param {string|null} savedTransform - 之前保存的 transform 状态
   */
  addDiagramControls(container, diagramType = 'Mermaid', savedTransform = null) {
    // 创建控制面板
    const controls = document.createElement('div')
    controls.className = 'mermaid-controls'
    controls.innerHTML = `
      <button class="mermaid-btn mermaid-zoom-in" title="放大">+</button>
      <button class="mermaid-btn mermaid-zoom-out" title="缩小">-</button>
      <button class="mermaid-btn mermaid-zoom-reset" title="重置">⟲</button>
    `

    // 根据图表类型获取可缩放元素 (Mermaid 是 SVG, PlantUML 是 IMG)
    const scalableElement = container.querySelector('svg') || container.querySelector('img')
    if (!scalableElement) {
      return
    }

    // 设置容器为可调整大小
    container.style.cssText = `
      position: relative;
      resize: both;
      overflow: hidden;
      min-width: 200px;
      min-height: 150px;
      max-width: 100%;
    `

    const wrapper = document.createElement('div')
    wrapper.className = 'mermaid-wrapper'
    wrapper.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      cursor: grab;
      overflow: visible;
      transition: none !important;
    `

    // 包裹可缩放元素
    scalableElement.style.position = 'relative'
    scalableElement.style.zIndex = '1'
    container.insertBefore(wrapper, container.firstChild)
    wrapper.appendChild(scalableElement)

    // 确保控制按钮在最上层
    controls.style.zIndex = '100'
    container.appendChild(controls)

    // 添加resize手柄指示器
    const resizeHandle = document.createElement('div')
    resizeHandle.className = 'mermaid-resize-handle'
    resizeHandle.innerHTML = '⋮'
    resizeHandle.style.zIndex = '100'
    container.appendChild(resizeHandle)

    // 从保存的 transform 状态中解析出 scale, translateX, translateY
    let scale = 1
    let translateX = 0
    let translateY = 0
    
    if (savedTransform) {
      // 解析 transform 字符串: "translate(xpx, ypx) scale(s)"
      const translateMatch = savedTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/)
      const scaleMatch = savedTransform.match(/scale\(([^)]+)\)/)
      
      if (translateMatch) {
        translateX = parseFloat(translateMatch[1])
        translateY = parseFloat(translateMatch[2])
      }
      if (scaleMatch) {
        scale = parseFloat(scaleMatch[1])
      }
    }
    
    let isDragging = false
    let startX = 0
    let startY = 0
    let hasTransformed = scale !== 1 || translateX !== 0 || translateY !== 0 // 根据保存的状态设置

    // 注意：transform 已经在 renderMermaid/renderDiagram 中应用了，这里不需要重复应用

    // 更新变换（使用 requestAnimationFrame 优化性能）
    let rafId = null
    const updateTransform = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      
      rafId = requestAnimationFrame(() => {
        const transformValue = `translate(${translateX}px, ${translateY}px) scale(${scale})`
        scalableElement.style.transform = transformValue
        scalableElement.style.transformOrigin = 'top left'
        
        // 将 transform 状态保存到 container 的 dataset 中，以便重新渲染时恢复
        container.dataset.diagramTransform = transformValue
        
        // 如果有变换,添加视觉反馈
        if (scale !== 1 || translateX !== 0 || translateY !== 0) {
          container.classList.add('diagram-focused')
          hasTransformed = true
        } else {
          container.classList.remove('diagram-focused')
          hasTransformed = false
          // 清除保存的状态
          delete container.dataset.diagramTransform
        }
        
        rafId = null
      })
    }

    // 重置变换
    const resetTransform = () => {
      scale = 1
      translateX = 0
      translateY = 0
      updateTransform()
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

    // 重置按钮
    controls.querySelector('.mermaid-zoom-reset').addEventListener('click', () => {
      resetTransform()
    })

    // 使用命名函数以便可以正确移除
    let handleMouseMove = null
    let handleMouseUp = null
    
    // 鼠标拖拽
    wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return // 只响应左键
      // 如果点击的是resize手柄,不启动拖拽
      if (e.target.classList.contains('mermaid-resize-handle')) return

      // 完全阻止事件传播（在设置状态之前）
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      
      // 先移除旧的监听器（如果存在）
      if (handleMouseMove) {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      isDragging = true
      startX = e.clientX - translateX
      startY = e.clientY - translateY
      wrapper.style.cursor = 'grabbing'
      // 拖拽时禁用 transition，防止残影
      scalableElement.style.transition = 'none'
      
      // 定义 mousemove 处理函数（使用节流优化性能）
      let lastMoveTime = 0
      handleMouseMove = (moveEvent) => {
        if (!isDragging) return
        
        // 节流：最多每 16ms (60fps) 更新一次
        const now = Date.now()
        if (now - lastMoveTime < 16) {
          return
        }
        lastMoveTime = now
        
        translateX = moveEvent.clientX - startX
        translateY = moveEvent.clientY - startY
        updateTransform()
        // 完全阻止事件传播
        moveEvent.preventDefault()
        moveEvent.stopPropagation()
        moveEvent.stopImmediatePropagation()
      }
      
      // 定义 mouseup 处理函数
      handleMouseUp = (upEvent) => {
        // 完全阻止事件传播，防止触发 Vue 更新
        if (upEvent) {
          upEvent.preventDefault()
          upEvent.stopPropagation()
          upEvent.stopImmediatePropagation()
        }
        
        isDragging = false
        wrapper.style.cursor = 'grab'
        
        // 强制应用当前的 transform，防止残影
        const currentTransform = scalableElement.style.transform
        if (currentTransform) {
          // 确保 transform 被正确应用
          scalableElement.style.transform = currentTransform
          scalableElement.style.transformOrigin = 'top left'
          // 使用 offsetWidth 强制触发重排（reflow），清除渲染残影
          void scalableElement.offsetWidth
        }
        
        // 移除监听器
        document.removeEventListener('mouseup', handleMouseUp)
        document.removeEventListener('mousemove', handleMouseMove)
        handleMouseMove = null
        handleMouseUp = null
      }
      
      // 立即添加监听器
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    })

    // 阻止控制按钮的 click 事件冒泡
    controls.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    // 阻止 resize 手柄的 click 事件冒泡
    resizeHandle.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    // 双击画布时重置
    wrapper.addEventListener('dblclick', (e) => {
      resetTransform()
    })

    // 鼠标滚轮缩放
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      scale = Math.max(0.2, Math.min(5, scale * delta))
      updateTransform()
    })

    // 添加全局双击重置功能（只添加一次）
    if (!this.diagramEventListenersAdded) {
      this.diagramEventListenersAdded = true
      document.addEventListener('dblclick', (e) => {
        // 检查双击的是否是图表区域
        const diagramContainer = e.target.closest('[data-diagram-transform]')
        if (!diagramContainer) {
          // 双击的是画布外，重置所有图表
          const allContainers = document.querySelectorAll('[data-diagram-transform]')
          allContainers.forEach(container => {
            const scalableElement = container.querySelector('.mermaid-wrapper svg') || container.querySelector('.mermaid-wrapper img')
            if (scalableElement) {
              scalableElement.style.transform = ''
              scalableElement.style.transformOrigin = ''
            }
            delete container.dataset.diagramTransform
            container.classList.remove('diagram-focused')
          })
        }
      }, true) // 使用捕获阶段，确保能捕获到所有双击事件
    }
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
            // 保存当前的 transform 状态（从 container 的 dataset 中读取）
            let savedTransform = target.dataset.diagramTransform || null
            
            // 如果 dataset 中没有，尝试从现有的 wrapper 中读取
            if (!savedTransform) {
              const existingWrapper = target.querySelector('.mermaid-wrapper')
              const existingScalable = existingWrapper?.querySelector('img')
              if (existingScalable && existingScalable.style.transform) {
                savedTransform = existingScalable.style.transform
              }
            }
            
            const diagram = render.parse(code)
            target.innerHTML = ''
            diagram.insertImgElement(target)
            
            // 如果有保存的 transform，立即应用（在 addDiagramControls 之前）
            if (savedTransform) {
              const scalableElement = target.querySelector('img')
              if (scalableElement) {
                scalableElement.style.transform = savedTransform
                scalableElement.style.transformOrigin = 'top left'
                target.classList.add('diagram-focused')
              }
            }
            
            // 立即添加交互控制
            this.addDiagramControls(target, 'PlantUML', savedTransform)
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

    // 保存所有图表容器的 transform 状态
    const savedTransforms = new Map()
    const diagramContainers = rootDom.querySelectorAll('[data-diagram-transform]')
    diagramContainers.forEach(container => {
      savedTransforms.set(container.id, container.dataset.diagramTransform)
    })

    patch(oldVdom, newVdom)

    // 恢复所有图表容器的 transform 状态
    savedTransforms.forEach((transform, id) => {
      const container = document.getElementById(id)
      if (container && transform) {
        container.dataset.diagramTransform = transform
      }
    })

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

    // 保存所有图表容器的 transform 状态
    const savedTransforms = new Map()
    const diagramContainers = document.querySelectorAll('[data-diagram-transform]')
    diagramContainers.forEach(container => {
      savedTransforms.set(container.id, container.dataset.diagramTransform)
    })

    firstOldDom.insertAdjacentHTML('beforebegin', html)

    Array.from(needToRemoved).forEach((dom) => dom.remove())

    // 恢复所有图表容器的 transform 状态
    savedTransforms.forEach((transform, id) => {
      const container = document.getElementById(id)
      if (container && transform) {
        container.dataset.diagramTransform = transform
      }
    })

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

    // 保存所有图表容器的 transform 状态
    const savedTransforms = new Map()
    const diagramContainers = document.querySelectorAll('[data-diagram-transform]')
    diagramContainers.forEach(container => {
      savedTransforms.set(container.id, container.dataset.diagramTransform)
    })

    patch(oldVdom, newVdom)

    // 恢复所有图表容器的 transform 状态
    savedTransforms.forEach((transform, id) => {
      const container = document.getElementById(id)
      if (container && transform) {
        container.dataset.diagramTransform = transform
      }
    })

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
