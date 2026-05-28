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
          :class="{ active: currentFile?.id === file.id, unsaved: !file.isSaved }"
          :data-id="file.id"
          @click.stop="selectFile(file)"
          @click.middle="closeTab(file.id)"
          @contextmenu.prevent="handleContextMenu($event, file)"
        >
          <span>{{ file.filename }}</span>
          <span class="unsaved-dot" />
          <el-icon
            class="close-icon"
            :size="12"
            @click.stop="removeFileInTab(file)"
          >
            <Close />
          </el-icon>
        </li>
      </ul>
    </div>
    <div
      class="new-file"
      @click.stop="newFile()"
    >
      <el-icon :size="16">
        <Plus />
      </el-icon>
    </div>

    <!-- Window controls (non-macOS custom mode only) -->
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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { storeToRefs } from 'pinia'
import autoScroll from 'dom-autoscroller'
import dragula from 'dragula'
import { Plus, Close } from '@element-plus/icons-vue'
import { showContextMenu } from '../../contextMenu/tabs'
import { minimizePath, restorePath, maximizePath, closePath } from '../../assets/window-controls.js'
import { isOsx as isOsxPlatform } from '@/util'
import bus from '../../bus'
import type { IFileState } from '@shared/types/files'
import type { FileWordCount } from '@shared/types/files'

const editorStore = useEditorStore()
const layoutStore = useLayoutStore()
const preferencesStore = usePreferencesStore()

const { currentFile, tabs } = storeToRefs(editorStore)
const { titleBarStyle } = storeToRefs(preferencesStore)

const tabContainer = ref<HTMLElement | null>(null)
const tabDropContainer = ref<HTMLElement | null>(null)
// dom-autoscroller / dragula carry runtime APIs we don't yet model. Keep them
// loose at the top of the file rather than retyping the libraries.
let autoScroller: any = null
let drake: dragula.Drake | null = null

// Window controls state
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

// Computed properties

// Methods incorporated from tabsMixins
const selectFile = (file: IFileState) => {
  if (file.id !== currentFile.value?.id) {
    editorStore.UPDATE_CURRENT_FILE(file)
  }
}

const removeFileInTab = (file: IFileState) => {
  const { isSaved } = file
  if (isSaved) {
    editorStore.FORCE_CLOSE_TAB(file)
  } else {
    editorStore.CLOSE_UNSAVED_TAB(file)
  }
}

// Original methods
const newFile = () => {
  editorStore.NEW_UNTITLED_TAB({})
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

const closeTab = (tabId: unknown) => {
  const tab = tabs.value.find((f) => f.id === tabId)
  if (tab) {
    editorStore.CLOSE_TAB(tab)
  }
}

const closeOthers = (tabId: unknown) => {
  const tab = tabs.value.find((f) => f.id === tabId)
  if (tab) {
    editorStore.CLOSE_OTHER_TABS(tab)
  }
}

const closeSaved = () => {
  editorStore.CLOSE_SAVED_TABS()
}

const closeAll = () => {
  editorStore.CLOSE_ALL_TABS()
}

const changeMaxWidth = (width: unknown) => {
  layoutStore.CHANGE_SIDE_BAR_WIDTH(width as number)
}

const rename = (tabId: unknown) => {
  const tab = tabs.value.find((f) => f.id === tabId)
  if (tab && tab.pathname) {
    editorStore.RENAME_FILE(tab)
  }
}

const copyPath = (tabId: unknown) => {
  const tab = tabs.value.find((f) => f.id === tabId)
  if (tab && tab.pathname) {
    window.electron.clipboard.writeText(tab.pathname)
  }
}

const showInFolder = (tabId: unknown) => {
  const tab = tabs.value.find((f) => f.id === tabId)
  if (tab && tab.pathname) {
    window.electron.shell.showItemInFolder(tab.pathname)
  }
}

const handleContextMenu = (event: MouseEvent, tab: IFileState) => {
  if (tab.id) {
    showContextMenu(event, tab)
  }
}

onMounted(() => {
  bus.on('TABS::close-this', closeTab)
  bus.on('TABS::close-others', closeOthers)
  bus.on('TABS::close-saved', closeSaved)
  bus.on('TABS::close-all', closeAll)
  bus.on('TABS::rename', rename)
  bus.on('TABS::copy-path', copyPath)
  bus.on('TABS::show-in-folder', showInFolder)
  bus.on('EDITOR_TABS::change-max-width', changeMaxWidth)

  // Initialize window state for controls
  try {
    Promise.all([
      window.electron.windowControl.isFullScreen(),
      window.electron.windowControl.isMaximized()
    ]).then(([fs, max]) => {
      isFullScreen.value = !!fs
      isMaximized.value = !!max
    })
  } catch {}

  const onMaximize = () => { isMaximized.value = true }
  const onUnmaximize = () => { isMaximized.value = false }
  const onEnterFullScreen = () => { isFullScreen.value = true }
  const onLeaveFullScreen = () => { isFullScreen.value = false }

  offMaximize = window.electron.ipcRenderer.on('mt::window-maximize', onMaximize)
  offUnmaximize = window.electron.ipcRenderer.on('mt::window-unmaximize', onUnmaximize)
  offEnterFullScreen = window.electron.ipcRenderer.on('mt::window-enter-full-screen', onEnterFullScreen)
  offLeaveFullScreen = window.electron.ipcRenderer.on('mt::window-leave-full-screen', onLeaveFullScreen)

  const tabsEl = tabContainer.value
  if (!tabsEl || !tabDropContainer.value) return

  // Allow to scroll through the tabs by mouse wheel or touchpad.
  tabsEl.addEventListener('wheel', handleTabScroll)

  // Allow tab drag and drop to reorder tabs.
  drake = dragula([tabDropContainer.value], {
    direction: 'horizontal',
    revertOnSpill: true,
    mirrorContainer: tabDropContainer.value,
    ignoreInputTextSelection: false
  }).on('drop', (el, _target, _source, sibling) => {
    // Current tab that was dropped and need to be reordered.
    const droppedId = el?.getAttribute('data-id')
    // This should be the next tab (tab | ... | el | sibling | tab | ...) but may be
    // the mirror image or null (tab | ... | el | sibling or null) if last tab.
    const nextTabId = sibling ? sibling.getAttribute('data-id') : null
    const isLastTab = !sibling || sibling.classList.contains('gu-mirror')
    if (!droppedId || (sibling && !nextTabId)) {
      console.error('Tab reorder error: invalid tab IDs')
      return
    }

    editorStore.EXCHANGE_TABS_BY_ID({
      fromId: droppedId,
      toId: isLastTab ? null : nextTabId
    })
  })

  // Scroll when dragging a tab to the beginning or end of the tab container.
  autoScroller = autoScroll([tabsEl], {
    margin: 20,
    maxSpeed: 6,
    scrollWhenOutside: false,
    autoScroll: () => {
      return autoScroller.down && drake?.dragging
    }
  })
})

onBeforeUnmount(() => {
  const tabsEl = tabContainer.value
  if (tabsEl) {
    tabsEl.removeEventListener('wheel', handleTabScroll)
  }

  if (autoScroller) {
    // Force destroy
    autoScroller.destroy(true)
  }
  if (drake) {
    drake.destroy()
  }

  // Remove event listeners
  bus.off('TABS::close-this', closeTab)
  bus.off('TABS::close-others', closeOthers)
  bus.off('TABS::close-saved', closeSaved)
  bus.off('TABS::close-all', closeAll)
  bus.off('TABS::rename', rename)
  bus.off('TABS::copy-path', copyPath)
  bus.off('TABS::show-in-folder', showInFolder)
  bus.off('EDITOR_TABS::change-max-width', changeMaxWidth)

  if (offMaximize) offMaximize()
  if (offUnmaximize) offUnmaximize()
  if (offEnterFullScreen) offEnterFullScreen()
  if (offLeaveFullScreen) offLeaveFullScreen()
})
</script>

<style scoped>
.close-icon {
  cursor: pointer;
  transition: opacity 0.15s ease-in-out;
}

.close-icon:hover {
  color: var(--focusColor);
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
    padding: 0 8px;
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
      opacity: 0;
    }
    &:focus {
      outline: none;
    }
    &:hover {
      background: var(--floatBgColor) !important;
    }
    &:hover > .close-icon {
      opacity: 1;
    }
    &:hover > .unsaved-dot {
      display: none;
    }
    & > span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 3px;
    }
    & > .unsaved-dot {
      display: none;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--themeColor);
      flex-shrink: 0;
    }
  }
  & > li.unsaved:not(.active) {
    & > .close-icon {
      opacity: 0;
    }
    & > .unsaved-dot {
      display: block;
    }
    &:hover > .close-icon {
      opacity: 1;
    }
    &:hover > .unsaved-dot {
      display: none;
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
    & > .close-icon {
      opacity: 1;
    }
    & > .unsaved-dot {
      display: none;
    }
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
  &.always-visible {
    opacity: 1;
  }
}

.editor-tabs > .new-file:hover {
  transition: all 0.15s ease-in-out;
  & > svg {
    fill: var(--focusColor);
  }
}

/* Window controls in tabs */
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

/* Left toolbar spacing in tabs */
.editor-tabs.has-left-toolbar {
  padding-left: 100px;
}
.editor-tabs.has-menu-only {
  padding-left: 40px;
}

/* tooltip content */
.title-item {
  height: 28px;
  line-height: 28px;
  & .front {
    opacity: 0.7;
  }
  & .text {
    margin-left: 10px;
  }
}

/* dragula effects */
.gu-mirror {
  position: fixed !important;
  margin: 0 !important;
  z-index: 9999 !important;
  opacity: 0.8;
  cursor: grabbing;
}
.gu-hide {
  display: none !important;
}
.gu-unselectable {
  user-select: none !important;
}
.gu-transit {
  opacity: 0.2;
}
</style>
