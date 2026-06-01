<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px - ${effectiveRightTocWidth}px - ${effectiveMinimapWidth}px)` }"
  >
    <tabs v-show="showTabBar" />
    <div
      class="container"
      :class="{ 'side-by-side': sideBySide, 'source-left': sideBySide && sideBySideSourceLeft }"
    >
      <editor
        ref="editorRef"
        :markdown="markdown"
        :cursor="cursor"
        :text-direction="textDirection"
        :platform="platform"
        :class="{ 'side-by-side-panel': sideBySide }"
      />
      <source-code
        v-if="sourceCode || sideBySide"
        ref="sourceCodeRef"
        :markdown="markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
        :class="{ 'side-by-side-panel': sideBySide }"
      />
    </div>
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import { storeToRefs } from 'pinia'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'

const MINIMAP_WIDTH = 100

const props = defineProps<{
  markdown: string
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  sideBySide: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
}>()

const { effectiveSideBarWidth, showRightToc, rightTocWidth } = storeToRefs(useLayoutStore())
const { showMinimap, sideBySideSourceLeft } = storeToRefs(usePreferencesStore())
const { currentFile } = storeToRefs(useEditorStore())

const effectiveRightTocWidth = computed(() => (showRightToc.value ? rightTocWidth.value : 0))
const effectiveMinimapWidth = computed(() => (showMinimap.value ? MINIMAP_WIDTH : 0))

// Refs to editor components
const editorRef = ref<InstanceType<typeof Editor> | null>(null)
const sourceCodeRef = ref<InstanceType<typeof SourceCode> | null>(null)

// --------------------------------------------------------------------------
// Side-by-side scroll synchronization
// --------------------------------------------------------------------------

let isSyncingScroll = false
let syncSource: 'muya' | 'codemirror' | null = null
let muyaScrollTarget: HTMLElement | null = null
let cmScrollTarget: HTMLElement | null = null
let cmScrollElTarget: HTMLElement | null = null
let cmWheelTarget: HTMLElement | null = null
let syncScrollRafId: number | null = null
let cmScrollHandler: (() => void) | null = null
let syncLockTimer: ReturnType<typeof setTimeout> | null = null

const getScrollTargets = () => {
  const muyaEditor = (editorRef.value as any)?.editor
  const cmContainer = (sourceCodeRef.value as any)?.sourceCodeContainer as HTMLElement | null
  const cmEditor = (sourceCodeRef.value as any)?.editor
  const cmScrollEl = (cmEditor?.getScrollerElement?.() as HTMLElement | null) ?? null
  return {
    muya: muyaEditor?.container as HTMLElement | null,
    cm: cmContainer,
    cmScrollEl
  }
}

const releaseSyncLock = () => {
  isSyncingScroll = false
  syncSource = null
  if (syncLockTimer) {
    clearTimeout(syncLockTimer)
    syncLockTimer = null
  }
}

const onMuyaScroll = () => syncScroll('muya')
const onCmScroll = () => syncScroll('codemirror')
const onCmWheel = () => syncScroll('codemirror')

const syncScroll = (source: 'muya' | 'codemirror') => {
  if (!props.sideBySide) return

  if (isSyncingScroll && syncSource && syncSource !== source) {
    return
  }

  const { muya, cm } = getScrollTargets()
  if (!muya || !cm) return

  if (syncScrollRafId !== null) {
    return
  }

  syncScrollRafId = requestAnimationFrame(() => {
    syncScrollRafId = null
    isSyncingScroll = true
    syncSource = source

    if (source === 'muya') {
      const muyaMax = muya.scrollHeight - muya.clientHeight
      const cmMax = cm.scrollHeight - cm.clientHeight
      if (muyaMax > 0 && cmMax > 0) {
        const ratio = muya.scrollTop / muyaMax
        cm.scrollTop = ratio * cmMax
      }
    } else {
      const cmMax = cm.scrollHeight - cm.clientHeight
      const muyaMax = muya.scrollHeight - muya.clientHeight
      if (cmMax > 0 && muyaMax > 0) {
        const ratio = cm.scrollTop / cmMax
        muya.scrollTop = ratio * muyaMax
      }
    }

    if (syncLockTimer) clearTimeout(syncLockTimer)
    syncLockTimer = setTimeout(releaseSyncLock, 150)
  })
}

const setupScrollSync = () => {
  teardownScrollSync()
  const { muya, cm, cmScrollEl } = getScrollTargets()
  if (muya) {
    muya.addEventListener('scroll', onMuyaScroll, { passive: true })
    muyaScrollTarget = muya
  }
  if (cm) {
    cm.addEventListener('scroll', onCmScroll, { passive: true })
    cmScrollTarget = cm
    cm.addEventListener('wheel', onCmWheel, { passive: true })
    cmWheelTarget = cm
  }
  if (cmScrollEl) {
    cmScrollEl.addEventListener('scroll', onCmScroll, { passive: true })
    cmScrollElTarget = cmScrollEl
  }
  const cmEditor = (sourceCodeRef.value as any)?.editor
  if (cmEditor) {
    cmScrollHandler = () => syncScroll('codemirror')
    cmEditor.on('scroll', cmScrollHandler)
  }
}

const teardownScrollSync = () => {
  if (muyaScrollTarget) {
    muyaScrollTarget.removeEventListener('scroll', onMuyaScroll)
    muyaScrollTarget = null
  }
  if (cmScrollTarget) {
    cmScrollTarget.removeEventListener('scroll', onCmScroll)
    cmScrollTarget = null
  }
  if (cmWheelTarget) {
    cmWheelTarget.removeEventListener('wheel', onCmWheel)
    cmWheelTarget = null
  }
  if (cmScrollElTarget) {
    cmScrollElTarget.removeEventListener('scroll', onCmScroll)
    cmScrollElTarget = null
  }
  const cmEditor = (sourceCodeRef.value as any)?.editor
  if (cmEditor && cmScrollHandler) {
    cmEditor.off('scroll', cmScrollHandler)
  }
  cmScrollHandler = null
  if (syncScrollRafId !== null) {
    cancelAnimationFrame(syncScrollRafId)
    syncScrollRafId = null
  }
  if (syncLockTimer) {
    clearTimeout(syncLockTimer)
    syncLockTimer = null
  }
  releaseSyncLock()
}

watch(
  () => props.sideBySide,
  (value) => {
    // Toggle Muya read-only mode: in side-by-side the WYSIWYG pane is a
    // live preview and should not steal focus from the source pane.
    editorRef.value?.setReadOnly?.(value)

    if (value) {
      nextTick(() => {
        teardownScrollSync()
        setupScrollSync()
          ; (editorRef.value as any)?.scheduleUpdateLineNumbers?.()
          ; (sourceCodeRef.value as any)?.scheduleUpdateLineNumbers?.()
      })
    } else {
      teardownScrollSync()
    }
  }
)

// --------------------------------------------------------------------------
// Side-by-side content synchronization
// --------------------------------------------------------------------------

let silentUpdating = false

watch(
  () => currentFile.value?.markdown,
  (newMarkdown, oldMarkdown) => {
    if (
      silentUpdating ||
      !props.sideBySide ||
      newMarkdown === oldMarkdown ||
      typeof newMarkdown !== 'string'
    ) {
      return
    }

    const cmEditor = (sourceCodeRef.value as any)?.editor
    const muyaEditor = (editorRef.value as any)?.editor

    const cmHasFocus = !!cmEditor?.hasFocus?.()
    const muyaHasFocus = !!muyaEditor?.hasFocus?.()

    if (cmHasFocus && editorRef.value?.silentSetMarkdown) {
      silentUpdating = true
      editorRef.value.silentSetMarkdown(newMarkdown)
      silentUpdating = false
    } else if (muyaHasFocus && sourceCodeRef.value?.silentSetValue) {
      silentUpdating = true
      sourceCodeRef.value.silentSetValue(newMarkdown)
      silentUpdating = false
    }
  }
)

onMounted(() => {
  if (props.sideBySide) {
    nextTick(() => {
      teardownScrollSync()
      setupScrollSync()
    })
  }
})

onBeforeUnmount(() => {
  teardownScrollSync()
})
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    flex: 1;
    overflow: hidden;
  }

  & > .container.side-by-side {
    display: flex;
    flex-direction: row;
  }

  & > .container.side-by-side.source-left {
    flex-direction: row-reverse;
  }
}

.side-by-side-panel {
  flex: 0 0 50%;
  min-width: 0;
  max-width: 50%;
}
</style>
