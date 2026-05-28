<template>
  <div class="editor-container">
    <side-bar v-if="init" />

    <div class="editor-middle">
      <title-bar
        v-if="!showTabBar"
        :project="projectTree"
        :pathname="pathname"
        :filename="filename"
        :active="windowActive"
        :word-count="wordCount"
        :platform="platform"
        :is-saved="isSaved"
      />

      <div
        v-if="!init"
        class="editor-placeholder"
      />
      <recent v-if="!hasCurrentFile && init" />
      <editor-with-tabs
        v-if="hasCurrentFile && init"
        :markdown="markdown"
        :cursor="cursor"
        :muya-index-cursor="muyaIndexCursor"
        :source-code="sourceCode"
        :show-tab-bar="showTabBar"
        :text-direction="textDirection"
        :platform="platform"
      />
      <command-palette />
      <about-dialog />
      <export-setting-dialog />
      <rename />
      <import-modal />
    </div>

    <!-- ✅ 拖拽条:位于正文和右侧TOC之间 -->
    <div 
      v-if="showRightToc && init" 
      ref="resizeHandle"
      class="resize-handle"
    ></div>

    <right-toc-panel v-if="showRightToc && init"></right-toc-panel>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { addStyles, addThemeStyle, addCustomStyle, type AddStylesOptions } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import TitleBar from '@/components/titleBar/index.vue'
import SideBar from '@/components/sideBar/index.vue'
import RightTocPanel from '@/components/sideBar/rightTocPanel.vue'
import AboutDialog from '@/components/about/index.vue'
import CommandPalette from '@/components/commandPalette/index.vue'
import ExportSettingDialog from '@/components/exportSettings/index.vue'
import Rename from '@/components/rename/index.vue'
import Tweet from '@/components/tweet'
import ImportModal from '@/components/import/index.vue'
import bus from '@/bus'
import { DEFAULT_STYLE } from '@/config'
import { useLayoutStore } from '@/store/layout'
import { useListenForMainStore } from '@/store/listenForMain'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import { useCommandCenterStore } from '@/store/commandCenter'
import { useProjectStore } from '@/store/project'
import { useAutoUpdatesStore } from '@/store/autoUpdates'
import { useNotificationStore } from '@/store/notification'

const mainStore = useMainStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const listenForMainStore = useListenForMainStore()
const autoUpdateStore = useAutoUpdatesStore()
const commandCenterStore = useCommandCenterStore()
const notificationStore = useNotificationStore()

const timer = ref<ReturnType<typeof setTimeout> | null>(null)
const resizeHandle = ref<HTMLElement | null>(null)

// 拖拽相关变量
let startX = 0
let startWidth = 0
let mouseMoveHandler: ((event: MouseEvent) => void) | null = null
let mouseUpHandler: (() => void) | null = null

// States from Pinia
const { windowActive, platform, init } = storeToRefs(mainStore)
const { showTabBar, showRightToc } = storeToRefs(layoutStore)
const { sourceCode, theme, customCss, textDirection, zoom } = storeToRefs(preferencesStore)
const { projectTree } = storeToRefs(projectStore)
const { currentFile } = storeToRefs(editorStore)

const pathname = computed(() => currentFile.value?.pathname)
const filename = computed(() => currentFile.value?.filename)
const isSaved = computed(() => currentFile.value?.isSaved)
// `markdown` is read by `<editor-with-tabs>` whose prop is `required: true`.
// In template space we render that subtree only when `hasCurrentFile` is set,
// but vue-tsc can't see through the v-if guard — coalesce to '' so the prop
// type is `string`. The `<editor-with-tabs>` mount is still gated.
const markdown = computed<string>(() => currentFile.value?.markdown ?? '')
const cursor = computed(() => currentFile.value?.cursor)
const wordCount = computed(() => currentFile.value?.wordCount)
// `muyaIndexCursor` is loosely typed as `unknown` on the editor store; the
// downstream prop expects `Object | undefined`. Cast at the boundary.
const muyaIndexCursor = computed<Record<string, unknown> | undefined>(
  () => currentFile.value?.muyaIndexCursor as Record<string, unknown> | undefined
)

const hasCurrentFile = computed<boolean>(() => {
  return currentFile.value?.markdown !== undefined
})

// Watchers
watch(theme, (value, oldValue) => {
  if (value !== oldValue) {
    addThemeStyle(value)
  }
})

watch(customCss, (value, oldValue) => {
  if (value !== oldValue) {
    addCustomStyle({
      customCss: value
    })
  }
})

watch(zoom, (zoomValue) => {
  bus.emit('mt::window-zoom', zoomValue)
})

const setupDragDropHandler = (): void => {
  window.addEventListener(
    'dragover',
    (e: DragEvent) => {
      if (!e.dataTransfer || !e.dataTransfer.types.length) return

      if (e.dataTransfer.types.indexOf('Files') >= 0) {
        if (
          e.dataTransfer.items.length === 1 &&
          e.dataTransfer.items[0]!.type.indexOf('image') > -1
        ) {
          // Do nothing
        } else {
          e.preventDefault()
          if (timer.value) {
            clearTimeout(timer.value)
          }
          timer.value = setTimeout(() => {
            bus.emit('importDialog', false)
          }, 300)
          bus.emit('importDialog', true)
        }
        e.dataTransfer.dropEffect = 'copy'
      } else {
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'none'
      }
    },
    false
  )
}
onMounted(async () => {
  if (window.marktext?.initialState) {
    preferencesStore.SET_USER_PREFERENCE(window.marktext.initialState)
  }

  mainStore.LISTEN_WIN_STATUS()
  await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()
  layoutStore.LISTEN_FOR_LAYOUT()
  listenForMainStore.LISTEN_FOR_EDIT()
  preferencesStore.LISTEN_FOR_VIEW()
  listenForMainStore.LISTEN_FOR_SHOW_DIALOG()
  listenForMainStore.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
  projectStore.LISTEN_FOR_UPDATE_PROJECT()
  projectStore.LISTEN_FOR_LOAD_PROJECT()
  projectStore.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()
  autoUpdateStore.LISTEN_FOR_UPDATE()
  preferencesStore.ASK_FOR_USER_PREFERENCE()
  preferencesStore.LISTEN_TOGGLE_VIEW()
  editorStore.LISTEN_SCREEN_SHOT()
  editorStore.LISTEN_FOR_CLOSE()
  editorStore.LISTEN_FOR_SAVE_AS()
  editorStore.LISTEN_FOR_MOVE_TO()
  editorStore.LISTEN_FOR_SAVE()
  editorStore.LISTEN_FOR_SET_PATHNAME()
  editorStore.LISTEN_FOR_BOOTSTRAP_WINDOW()
  editorStore.LISTEN_FOR_SAVE_CLOSE()
  editorStore.LISTEN_FOR_RENAME()
  editorStore.LINTEN_FOR_SET_LINE_ENDING()
  editorStore.LINTEN_FOR_SET_ENCODING()
  editorStore.LINTEN_FOR_SET_FINAL_NEWLINE()
  editorStore.LISTEN_FOR_NEW_TAB()
  editorStore.LISTEN_FOR_CLOSE_TAB()
  editorStore.LISTEN_FOR_TAB_CYCLE()
  editorStore.LISTEN_FOR_SWITCH_TABS()
  editorStore.LINTEN_FOR_PRINT_SERVICE_CLEARUP()
  editorStore.LINTEN_FOR_EXPORT_SUCCESS()
  editorStore.LISTEN_FOR_FILE_CHANGE()
  editorStore.LISTEN_WINDOW_ZOOM()
  editorStore.LISTEN_FOR_RELOAD_IMAGES()
  editorStore.LISTEN_FOR_CONTEXT_MENU()
  editorStore.LISTEN_FOR_STATE_REPLACE()

  // module: notification
  notificationStore.listenForNotification()

  setupDragDropHandler()

  nextTick(() => {
    // `initialState` from bootstrap carries nullable URL params (string|null);
    // `addStyles` requires non-null `theme` / `codeFontFamily` strings.
    // Coalesce against DEFAULT_STYLE for every nullable field.
    const init = window.marktext?.initialState
    const style: AddStylesOptions = {
      theme: init?.theme ?? DEFAULT_STYLE.theme,
      codeFontFamily: init?.codeFontFamily ?? DEFAULT_STYLE.codeFontFamily,
      codeFontSize: init?.codeFontSize ?? DEFAULT_STYLE.codeFontSize,
      hideScrollbar: init?.hideScrollbar ?? DEFAULT_STYLE.hideScrollbar
    }
    addStyles(style)
  })

  // ✅ 初始化拖拽条
  const initResizeHandle = () => {
    nextTick(() => {
      const handle = resizeHandle.value
      if (!handle) return

      const onMouseDown = (event: MouseEvent) => {
        event.preventDefault()
        startX = event.clientX
        
        // 获取当前右侧 TOC 面板的宽度
        const tocPanel = document.querySelector('.right-toc-panel') as HTMLElement
        if (tocPanel) {
          startWidth = tocPanel.offsetWidth
        }

        // 添加全局事件监听
        mouseMoveHandler = (e: MouseEvent) => {
          const offset = startX - e.clientX  // 向左拖动增加宽度,向右减小
          const newWidth = Math.max(0, startWidth + offset)  // ✅ 最小宽度 0px
          
          // 更新 store 中的宽度
          layoutStore.CHANGE_RIGHT_TOC_WIDTH(newWidth)
        }

        mouseUpHandler = () => {
          // 清理事件监听
          if (mouseMoveHandler) {
            document.removeEventListener('mousemove', mouseMoveHandler)
            mouseMoveHandler = null
          }
          if (mouseUpHandler) {
            document.removeEventListener('mouseup', mouseUpHandler)
            mouseUpHandler = null
          }
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', mouseMoveHandler)
        document.addEventListener('mouseup', mouseUpHandler)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }

      handle.addEventListener('mousedown', onMouseDown)
    })
  }

  // 初始化拖拽条
  initResizeHandle()
  
  // ✅ 监听 showRightToc 变化,重新初始化拖拽条
  watch(showRightToc, (newValue) => {
    console.log('[app.vue] showRightToc changed:', newValue, 'init:', init.value)
    if (newValue) {
      initResizeHandle()
    }
  })

  // ✅ 监听 init 变化
  watch(init, (newValue) => {
    console.log('[app.vue] init changed:', newValue)
  })
})

// ✅ 组件卸载时清理
onBeforeUnmount(() => {
  if (mouseMoveHandler) {
    document.removeEventListener('mousemove', mouseMoveHandler)
  }
  if (mouseUpHandler) {
    document.removeEventListener('mouseup', mouseUpHandler)
  }
})
</script>

<style scoped>
.editor-placeholder,
.editor-container {
  display: flex;
  flex-direction: row;
  position: absolute;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.editor-container .hide {
  z-index: -1;
  opacity: 0;
  position: absolute;
  left: -10000px;
}
.editor-placeholder {
  background: var(--editorBgColor);
}
.editor-middle {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100vh;
  position: relative;
  & > .editor {
    flex: 1;
  }
}

/* ✅ 拖拽条样式:位于正文和右侧TOC之间 */
.resize-handle {
  width: 4px;  /* 最小宽度,几乎不可见 */
  height: 100%;
  cursor: col-resize;
  z-index: 9999;
  background: transparent;  /* 默认完全透明 */
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  flex-shrink: 0;  /* 防止被压缩 */
}

.resize-handle:hover {
  background: rgba(65, 105, 225, 0.3);  /* 悬停时显示淡蓝色 */
  width: 6px;
}

.resize-handle:active {
  background: rgba(65, 105, 225, 0.5);
}
</style>

<style>
/* 全局样式:优化滚动条显示 */
.editor-middle ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.editor-middle ::-webkit-scrollbar-track {
  background: transparent;
}

.editor-middle ::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.3);
  border-radius: 4px;
  transition: background 0.2s ease;
}

.editor-middle:hover ::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.6);
}

.editor-middle ::-webkit-scrollbar-thumb:hover {
  background: rgba(128, 128, 128, 0.8);
}

/* Firefox 滚动条样式 */
.editor-middle {
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
}

.editor-middle:hover {
  scrollbar-color: rgba(128, 128, 128, 0.6) transparent;
}
</style>
