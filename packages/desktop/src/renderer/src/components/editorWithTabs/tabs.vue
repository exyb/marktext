<template>
  <div
    class="editor-tabs"
    :class="{
      'has-window-controls': showWindowControls,
      'has-left-toolbar': showCustomTitleBar || !!wordCount,
      'has-menu-only': showCustomTitleBar && !wordCount
    }"
  >
    <div
      ref="tabContainer"
      class="scrollable-tabs"
    >
      <ul
        ref="tabDropContainer"
        class="tabs-container"
      >
        <li
          v-for="file of tabs"
          :key="file.id"
          :title="file.pathname"
          :aria-label="
            file.isPreview ? t('editor.tabs.preview', { name: file.filename }) : file.filename
          "
          :class="{
            active: currentFile?.id === file.id,
            preview: file.isPreview,
            unsaved: !file.isSaved
          }"
          :data-id="file.id"
          @click.stop="selectFile(file)"
          @click.middle.stop.prevent="removeFileInTab(file)"
          @contextmenu.prevent="handleContextMenu($event, file)"
        >
          <el-icon
            v-if="file.readOnly"
            class="reading-lock"
            :title="t('readingMode.title')"
            :aria-label="t('readingMode.title')"
          >
            <Lock />
          </el-icon>
          <span>{{ file.filename }}</span>
          <span class="unsaved-dot" />
          <button
            type="button"
            class="plain-button close-icon"
            :aria-label="t('editor.tabs.close', { name: file.filename })"
            @click.stop="removeFileInTab(file)"
          >
            <el-icon :size="12">
              <Close />
            </el-icon>
          </button>
        </li>
      </ul>
    </div>
    <icon-tooltip :content="t('menu.file.newTab')">
      <button
        type="button"
        class="plain-button new-file"
        :aria-label="t('menu.file.newTab')"
        @click.stop="newFile()"
      >
        <el-icon :size="16">
          <Plus />
        </el-icon>
      </button>
    </icon-tooltip>

    <!-- Window controls (fork feature: non-macOS custom mode only) -->
    <div
      v-if="showWindowControls"
      class="window-controls"
    >
      <div
        class="frameless-titlebar-button frameless-titlebar-close"
        @click.stop="handleCloseClick"
      >
        <div>
          <svg
            width="10"
            height="10"
          >
            <path :d="windowIconClose" />
          </svg>
        </div>
      </div>
      <div
        class="frameless-titlebar-button frameless-titlebar-toggle"
        @click.stop="handleMaximizeClick"
      >
        <div>
          <svg
            width="10"
            height="10"
          >
            <path
              v-show="!isMaximized"
              :d="windowIconMaximize"
            />
            <path
              v-show="isMaximized"
              :d="windowIconRestore"
            />
          </svg>
        </div>
      </div>
      <div
        class="frameless-titlebar-button frameless-titlebar-minimize"
        @click.stop="handleMinimizeClick"
      >
        <div>
          <svg
            width="10"
            height="10"
          >
            <path :d="windowIconMinimize" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { storeToRefs } from 'pinia'
import { useTabReorder } from '../useTabReorder'
import { Plus, Close, Lock } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import IconTooltip from '@/components/iconTooltip/index.vue'
import { showContextMenu } from '../../contextMenu/tabs'
import { minimizePath, restorePath, maximizePath, closePath } from '../../assets/window-controls'
import { isMac as isOsxPlatform } from '@/util'
import type { IFileState, FileWordCount } from '@shared/types/files'

const { t } = useI18n()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const { currentFile, tabs } = storeToRefs(editorStore)
const { titleBarStyle } = storeToRefs(preferencesStore)

const tabContainer = ref<HTMLElement | null>(null)
const tabDropContainer = ref<HTMLElement | null>(null)
useTabReorder(tabDropContainer, tabContainer, 'horizontal')

// --------------------------------------------------------------------------
// Window controls in the tab bar (fork feature: replaces the native title bar
// when the tab bar is visible)
// --------------------------------------------------------------------------

const isOsx = isOsxPlatform
const isFullScreen = ref(false)
const isMaximized = ref(false)

const showWindowControls = computed(() => {
  return titleBarStyle.value === 'custom' && !isOsx && !isFullScreen.value
})

const showCustomTitleBar = computed(() => {
  return titleBarStyle.value === 'custom' && !isOsx
})

const wordCount = computed<FileWordCount | null>(() => {
  return currentFile.value?.wordCount ?? null
})

const windowIconMinimize = minimizePath
const windowIconRestore = restorePath
const windowIconMaximize = maximizePath
const windowIconClose = closePath

const handleCloseClick = () => {
  window.electron.windowControl.close()
}

const handleMaximizeClick = async () => {
  if (isFullScreen.value) {
    window.electron.windowControl.setFullScreen(false)
    return
  }
  if (isMaximized.value) window.electron.windowControl.unmaximize()
  else window.electron.windowControl.maximize()
}

const handleMinimizeClick = () => {
  window.electron.windowControl.minimize()
}

let offMaximize: (() => void) | null = null
let offUnmaximize: (() => void) | null = null
let offEnterFullScreen: (() => void) | null = null
let offLeaveFullScreen: (() => void) | null = null

const selectFile = (file: IFileState) => {
  if (file.id !== currentFile.value?.id) {
    editorStore.UPDATE_CURRENT_FILE(file)
  }
}

const removeFileInTab = (file: IFileState) => {
  editorStore.CLOSE_TAB(file)
}

const newFile = () => {
  editorStore.NEW_UNTITLED_TAB({})
}

// Keep the active tab visible when the selection changes by something other
// than a direct click on a visible tab (keyboard cycle, switch-by-index, open
// from the sidebar): the strip has `overflow: hidden` and only scrolls on the
// wheel, so an off-screen tab would otherwise stay hidden (#3958).
const scrollActiveTabIntoView = () => {
  const container = tabContainer.value
  if (!container) return
  const activeTab = container.querySelector<HTMLElement>('li.active')
  if (!activeTab) return

  const containerRect = container.getBoundingClientRect()
  const tabRect = activeTab.getBoundingClientRect()
  if (tabRect.left < containerRect.left) {
    container.scrollLeft -= containerRect.left - tabRect.left
  } else if (tabRect.right > containerRect.right) {
    container.scrollLeft += tabRect.right - containerRect.right
  }
}

const handleTabScroll = (event: WheelEvent) => {
  // Use mouse wheel value first but prioritize X value more (e.g. touchpad input).
  let delta = event.deltaY
  if (event.deltaX !== 0) {
    delta = event.deltaX
  }

  const tabsEl = tabContainer.value
  if (!tabsEl) return
  const newLeft = Math.max(0, Math.min(tabsEl.scrollLeft + delta, tabsEl.scrollWidth))
  tabsEl.scrollLeft = newLeft
}

const handleContextMenu = (event: MouseEvent, tab: IFileState) => {
  if (tab.id) {
    showContextMenu(event, tab)
  }
}

watch(
  () => currentFile.value?.id,
  () => {
    nextTick(scrollActiveTabIntoView)
  }
)

onMounted(() => {
  tabContainer.value?.addEventListener('wheel', handleTabScroll)

  // Initialize window state for controls (fork feature)
  try {
    Promise.all([
      window.electron.windowControl.isFullScreen(),
      window.electron.windowControl.isMaximized()
    ]).then(([fs, max]) => {
      isFullScreen.value = !!fs
      isMaximized.value = !!max
    })
  } catch {
    // Window control state is cosmetic; ignore preload API availability errors.
  }

  const onMaximize = () => { isMaximized.value = true }
  const onUnmaximize = () => { isMaximized.value = false }
  const onEnterFullScreen = () => { isFullScreen.value = true }
  const onLeaveFullScreen = () => { isFullScreen.value = false }

  offMaximize = window.electron.ipcRenderer.on('mt::window-maximize', onMaximize)
  offUnmaximize = window.electron.ipcRenderer.on('mt::window-unmaximize', onUnmaximize)
  offEnterFullScreen = window.electron.ipcRenderer.on('mt::window-enter-full-screen', onEnterFullScreen)
  offLeaveFullScreen = window.electron.ipcRenderer.on('mt::window-leave-full-screen', onLeaveFullScreen)
})

onBeforeUnmount(() => {
  tabContainer.value?.removeEventListener('wheel', handleTabScroll)

  if (offMaximize) offMaximize()
  if (offUnmaximize) offUnmaximize()
  if (offEnterFullScreen) offEnterFullScreen()
  if (offLeaveFullScreen) offLeaveFullScreen()
})
</script>

<style scoped>
.reading-lock {
  margin-inline-end: 6px;
  flex-shrink: 0;
}

/* Padding widens the hit area and keeps the inset focus ring off the glyph. */
.close-icon {
  padding: 2px;
  border-radius: 4px;
  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.close-icon:hover {
  color: var(--focusColor);
  background-color: var(--floatHoverColor);
}

.editor-tabs {
  position: relative;
  display: flex;
  flex-direction: row;
  height: 28px;
  user-select: none;
  box-shadow: 0px 0px 9px 2px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  -webkit-app-region: drag;
  &:hover > .new-file {
    opacity: 1 !important;
  }
}
.scrollable-tabs,
.tabs-container,
.new-file,
.window-controls,
.window-controls .frameless-titlebar-button {
  -webkit-app-region: no-drag;
}
.scrollable-tabs {
  flex: 0 1 auto;
  height: 28px;
  overflow: hidden;
}
.tabs-container {
  min-width: min-content;
  list-style: none;
  margin: 0;
  padding: 0;
  height: 28px;
  position: relative;
  display: flex;
  flex-direction: row;
  overflow-y: hidden;
  z-index: 2;
  &::-webkit-scrollbar:horizontal {
    display: none;
  }
  & > li {
    transition: all 0.15s ease-in-out;
    position: relative;
    padding: 0 28px 0 8px;
    cursor: pointer;
    color: var(--editorColor50);
    font-size: 12px;
    line-height: 28px;
    height: 28px;
    max-width: 280px;
    display: flex;
    align-items: center;
    &[aria-grabbed='true'] {
      color: var(--editorColor30) !important;
    }
    & > .close-icon {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 20px;
      height: 20px;
      margin: 0;
      box-sizing: border-box;
      opacity: 0;
    }
    &:focus {
      outline: none;
    }
    &:hover {
      background: var(--floatBgColor) !important;
    }
    &:hover > .close-icon,
    & > .close-icon:focus-visible {
      opacity: 1;
    }
    & > span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    & > .unsaved-dot {
      display: none;
      position: absolute;
      top: 11px;
      right: 11px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--themeColor);
      flex-shrink: 0;
    }
  }
  & > li.unsaved {
    & > .close-icon {
      opacity: 0;
    }
    & > .unsaved-dot {
      display: block;
    }
    &:has(> .close-icon:hover) > .close-icon,
    & > .close-icon:focus-visible {
      opacity: 1;
    }
    &:has(> .close-icon:hover) > .unsaved-dot,
    &:focus-within > .unsaved-dot {
      visibility: hidden;
    }
  }
  & > li.active {
    background: var(--itemBgColor);
    z-index: 3;
    &:after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      right: 0;
      height: 2px;
      background: var(--themeColor);
    }
  }
  & > li.preview > span {
    font-style: italic;
  }
}
.editor-tabs > .new-file {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border-right: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-around;
  cursor: pointer;
  color: var(--editorColor50);
  opacity: 0;
  &.always-visible,
  &:focus-visible {
    opacity: 1;
  }
}

.editor-tabs > .new-file:hover {
  transition: all 0.15s ease-in-out;
  & > svg {
    fill: var(--focusColor);
  }
}

/* Fork: window controls in tabs */
.editor-tabs.has-window-controls {
  padding-right: 138px;
}
.window-controls {
  position: fixed;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  height: 28px;
  z-index: 10;
}
.frameless-titlebar-button {
  position: relative;
  display: block;
  width: 46px;
  height: 28px;
  cursor: pointer;
}
.frameless-titlebar-button > div {
  position: absolute;
  display: inline-flex;
  top: 50%;
  left: 50%;
  transform: translateX(-50%) translateY(-50%);
}
.frameless-titlebar-close:hover {
  background-color: rgb(228, 79, 79);
}
.frameless-titlebar-minimize:hover,
.frameless-titlebar-toggle:hover {
  background-color: rgba(0, 0, 0, 0.1);
}
.frameless-titlebar-button svg {
  fill: #000000;
}
.frameless-titlebar-close:hover svg {
  fill: #ffffff;
}

/* Fork: left toolbar spacing in tabs */
.editor-tabs.has-left-toolbar {
  padding-left: 100px;
}
.editor-tabs.has-menu-only {
  padding-left: 40px;
}
</style>
