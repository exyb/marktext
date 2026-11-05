<template>
  <div
    v-if="hasContent"
    class="minimap-panel"
    :style="{ width: `${PANEL_WIDTH}px` }"
  >
    <canvas
      ref="canvasRef"
      class="minimap-canvas"
      @click="handleCanvasClick"
      @mousedown="handleMouseDown"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { storeToRefs } from 'pinia'

const PANEL_WIDTH = 100

const canvasRef = ref<HTMLCanvasElement | null>(null)
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const { currentFile } = storeToRefs(editorStore)
const { theme } = storeToRefs(preferencesStore)

const hasContent = computed(() => !!currentFile.value?.markdown)
const isDarkTheme = computed(() => /dark/i.test(theme.value))

let scrollElement: Element | null = null
let contentAnimationFrameId: number | null = null
let scrollAnimationFrameId: number | null = null
let resizeObserver: ResizeObserver | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let isDragging = false

const getScrollElement = (): Element | null => {
  const sourceCode = document.querySelector('.source-code')
  if (sourceCode && (sourceCode as HTMLElement).offsetParent !== null) {
    const cmScroll = sourceCode.querySelector('.CodeMirror-scroll')
    if (cmScroll) return cmScroll
    return sourceCode
  }
  const editorComponent = document.querySelector('.editor-component')
  if (editorComponent && (editorComponent as HTMLElement).offsetParent !== null) {
    return editorComponent
  }
  return null
}

const getContentRatio = (): number => {
  if (!scrollElement) return 0.88
  const se = scrollElement as HTMLElement
  const scrollHeight = se.scrollHeight

  // WYSIWYG mode: #ag-editor-id has padding-bottom: 100vh
  const editorId = se.querySelector('#ag-editor-id') as HTMLElement | null
  if (editorId) {
    const paddingBottom = parseFloat(window.getComputedStyle(editorId).paddingBottom) || 0
    if (paddingBottom > 0 && scrollHeight > 0) {
      return Math.min(0.95, Math.max(0.5, (scrollHeight - paddingBottom) / scrollHeight))
    }
  }

  // Source code mode: estimate from CodeMirror lines height
  const cmLines = se.querySelector('.CodeMirror-lines') as HTMLElement | null
  if (cmLines) {
    const contentHeight = cmLines.offsetHeight
    if (contentHeight > 0 && scrollHeight > contentHeight) {
      return Math.min(0.95, Math.max(0.5, contentHeight / scrollHeight))
    }
  }

  return 0.88
}

interface LineInfo {
  type: string
  length: number
}

const parseLines = (text: string): LineInfo[] => {
  if (!text) return []
  const rawLines = text.split('\n')
  let inCodeBlock = false

  return rawLines.map((line) => {
    const trimmed = line.trim()
    let type = 'text'

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      type = 'codeFence'
    } else if (inCodeBlock || line.startsWith('    ') || line.startsWith('\t')) {
      type = 'code'
    } else if (trimmed.startsWith('#')) {
      type = 'heading'
    } else if (trimmed === '') {
      type = 'empty'
    } else if (/^[-*+]\s/.test(trimmed)) {
      type = 'list'
    } else if (/^\d+\.\s/.test(trimmed)) {
      type = 'orderedList'
    } else if (trimmed.startsWith('>')) {
      type = 'quote'
    }

    return { type, length: line.length }
  })
}

const getLineColor = (type: string, dark: boolean): string => {
  const colors: Record<string, string> = dark
    ? {
        heading: 'rgba(230, 192, 123, 0.45)',
        code: 'rgba(152, 195, 121, 0.35)',
        codeFence: 'rgba(152, 195, 121, 0.35)',
        list: 'rgba(97, 175, 239, 0.3)',
        orderedList: 'rgba(97, 175, 239, 0.3)',
        quote: 'rgba(198, 120, 221, 0.3)',
        text: 'rgba(171, 178, 191, 0.2)',
        empty: 'transparent'
      }
    : {
        heading: 'rgba(121, 94, 38, 0.4)',
        code: 'rgba(38, 127, 153, 0.3)',
        codeFence: 'rgba(38, 127, 153, 0.3)',
        list: 'rgba(0, 16, 128, 0.25)',
        orderedList: 'rgba(0, 16, 128, 0.25)',
        quote: 'rgba(175, 0, 219, 0.25)',
        text: 'rgba(51, 51, 51, 0.15)',
        empty: 'transparent'
      }

  return colors[type] || colors.text
}

interface Segment {
  type: string
  startY: number
  endY: number
  avgLength: number
}

const drawContent = () => {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const markdown = currentFile.value?.markdown || ''
  const lines = parseLines(markdown)
  if (lines.length === 0) return

  const rect = canvas.parentElement!.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const width = rect.width
  const height = rect.height
  const contentRatio = getContentRatio()

  ctx.clearRect(0, 0, width, height)

  const maxLen = Math.max(...lines.map((l) => l.length), 1)

  // Approximate rendered height weights to make minimap distribution
  // closer to the actual editor content height distribution.
  const TYPE_WEIGHTS: Record<string, number> = {
    text: 1,
    empty: 0.25,
    heading: 1.8,
    code: 1.3,
    codeFence: 0.4,
    list: 1,
    orderedList: 1,
    quote: 1
  }

  const weights = lines.map((l) => TYPE_WEIGHTS[l.type] || 1)
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  const segments: Segment[] = []
  let currentType = lines[0]!.type
  let startLine = 0
  let weightSum = 0

  for (let i = 1; i <= lines.length; i++) {
    if (i === lines.length || lines[i]!.type !== currentType) {
      let sumLen = 0
      let segWeight = 0
      for (let j = startLine; j < i; j++) {
        sumLen += lines[j]!.length
        segWeight += weights[j]!
      }
      const startY = (weightSum / totalWeight) * height * contentRatio
      weightSum += segWeight
      const endY = (weightSum / totalWeight) * height * contentRatio

      segments.push({
        type: currentType,
        startY,
        endY,
        avgLength: sumLen / (i - startLine)
      })
      if (i < lines.length) {
        currentType = lines[i]!.type
        startLine = i
      }
    }
  }

  segments.forEach((seg) => {
    if (seg.type === 'empty') return
    ctx.fillStyle = getLineColor(seg.type, isDarkTheme.value)
    const y = seg.startY
    const h = Math.max(0.5, seg.endY - seg.startY)
    const lineWidth =
      seg.avgLength > 0 ? Math.max(4, (seg.avgLength / maxLen) * (width - 8)) : 0
    ctx.fillRect(4, y, lineWidth, h)
  })
}

const drawViewport = () => {
  const canvas = canvasRef.value
  if (!canvas || !scrollElement) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = canvas.width / (window.devicePixelRatio || 1)
  const height = canvas.height / (window.devicePixelRatio || 1)

  const se = scrollElement as HTMLElement
  const scrollTop = se.scrollTop
  const clientHeight = se.clientHeight
  const scrollHeight = se.scrollHeight

  if (scrollHeight > clientHeight) {
    const scrollableHeight = scrollHeight - clientHeight
    const viewportHeight = Math.max(20, (clientHeight / scrollHeight) * height)
    const viewportTop = (scrollTop / scrollableHeight) * (height - viewportHeight)

    ctx.fillStyle = isDarkTheme.value
      ? 'rgba(65, 105, 225, 0.18)'
      : 'rgba(65, 105, 225, 0.12)'
    ctx.fillRect(0, viewportTop, width, viewportHeight)
    ctx.strokeStyle = isDarkTheme.value
      ? 'rgba(65, 105, 225, 0.4)'
      : 'rgba(65, 105, 225, 0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(0, viewportTop, width, viewportHeight)
  }
}

const redrawAll = () => {
  if (contentAnimationFrameId !== null) {
    cancelAnimationFrame(contentAnimationFrameId)
  }
  contentAnimationFrameId = requestAnimationFrame(() => {
    drawContent()
    drawViewport()
  })
}

const redrawViewportOnly = () => {
  if (scrollAnimationFrameId !== null) {
    cancelAnimationFrame(scrollAnimationFrameId)
  }
  scrollAnimationFrameId = requestAnimationFrame(() => {
    drawContent()
    drawViewport()
  })
}

const handleScroll = () => {
  redrawViewportOnly()
}

const scrollToY = (y: number) => {
  if (!scrollElement) return
  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const clickY = y - rect.top
  const height = rect.height

  const se = scrollElement as HTMLElement
  const scrollHeight = se.scrollHeight
  const clientHeight = se.clientHeight

  const targetScrollTop = (clickY / height) * (scrollHeight - clientHeight)
  se.scrollTop = targetScrollTop
}

const handleCanvasClick = (event: MouseEvent) => {
  scrollToY(event.clientY)
}

const handleMouseDown = (event: MouseEvent) => {
  isDragging = true
  scrollToY(event.clientY)

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return
    scrollToY(e.clientY)
  }

  const handleMouseUp = () => {
    isDragging = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const bindScrollListener = () => {
  const newScrollElement = getScrollElement()
  if (newScrollElement !== scrollElement) {
    if (scrollElement) {
      scrollElement.removeEventListener('scroll', handleScroll)
    }
    scrollElement = newScrollElement
    if (scrollElement) {
      scrollElement.addEventListener('scroll', handleScroll, { passive: true })
      if (resizeObserver) {
        resizeObserver.observe(scrollElement)
      }
    }
  }
}

onMounted(() => {
  nextTick(() => {
    bindScrollListener()
    redrawAll()
  })

  intervalId = setInterval(() => {
    const oldElement = scrollElement
    bindScrollListener()
    if (scrollElement !== oldElement) {
      redrawAll()
    }
  }, 500)

  resizeObserver = new ResizeObserver(() => {
    redrawAll()
  })

  window.addEventListener('resize', redrawAll)
})

onBeforeUnmount(() => {
  if (scrollElement) {
    scrollElement.removeEventListener('scroll', handleScroll)
  }
  if (contentAnimationFrameId !== null) {
    cancelAnimationFrame(contentAnimationFrameId)
  }
  if (scrollAnimationFrameId !== null) {
    cancelAnimationFrame(scrollAnimationFrameId)
  }
  if (intervalId !== null) {
    clearInterval(intervalId)
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  window.removeEventListener('resize', redrawAll)
})

watch(() => currentFile.value?.markdown, () => {
  nextTick(() => {
    bindScrollListener()
    redrawAll()
  })
})

watch(theme, () => {
  nextTick(() => {
    redrawAll()
  })
})
</script>

<style scoped>
.minimap-panel {
  height: 76%;
  margin: 32px 4px 0 0;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  background: var(--sideBarBgColor);
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  flex-shrink: 0;
  overflow: hidden;
  opacity: 0.85;
}

.minimap-canvas {
  width: 100%;
  height: 100%;
  cursor: pointer;
}
</style>
