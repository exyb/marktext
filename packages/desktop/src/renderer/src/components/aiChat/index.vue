<template>
  <aside
    v-show="aiChat.panelOpen"
    class="ai-chat-panel"
    :style="{
      '--ai-chat-width': `${aiChat.panelWidth}px`,
      // Already a complete CSS value ('0px' | '28px' | 'var(--titleBarHeight)').
      '--ai-chat-top-offset': controlsOffset
    }"
  >
    <div
      class="drag-bar"
      @mousedown="startResize"
    />

    <header class="panel-header">
      <span class="panel-title">{{ t('aiChat.panel.title') }}</span>

      <el-select
        v-if="modelOptions.length > 0"
        class="model-select"
        :model-value="modelValue"
        size="small"
        :placeholder="t('aiChat.composer.pickModel')"
        @change="onModelChange"
      >
        <el-option-group
          v-for="provider in aiChat.config.providers"
          :key="provider.id"
          :label="provider.name"
        >
          <el-option
            v-for="model in provider.models"
            :key="`${provider.id}::${model}`"
            :label="model"
            :value="`${provider.id}::${model}`"
          />
        </el-option-group>
      </el-select>
      <span
        v-else
        class="model-missing"
        role="button"
        @click="aiChat.settingsVisible = true"
      >{{ t('aiChat.settings.noProvider') }}</span>

      <div class="header-actions">
        <icon-tooltip :content="t('aiChat.panel.history')">
          <button
            class="action-button"
            :class="{ 'is-active': aiChat.historyVisible }"
            type="button"
            :aria-label="t('aiChat.panel.history')"
            @click="aiChat.historyVisible = !aiChat.historyVisible"
          >
            <Clock aria-hidden="true" />
          </button>
        </icon-tooltip>
        <icon-tooltip :content="t('aiChat.panel.settings')">
          <button
            class="action-button"
            :class="{ 'is-active': aiChat.settingsVisible }"
            type="button"
            :aria-label="t('aiChat.panel.settings')"
            @click="aiChat.settingsVisible = true"
          >
            <Setting aria-hidden="true" />
          </button>
        </icon-tooltip>
        <icon-tooltip :content="t('aiChat.panel.close')">
          <button
            class="action-button"
            type="button"
            :aria-label="t('aiChat.panel.close')"
            @click="aiChat.panelOpen = false"
          >
            <Close aria-hidden="true" />
          </button>
        </icon-tooltip>
      </div>
    </header>

    <div
      v-if="aiChat.historyVisible"
      class="session-history"
    >
      <div class="history-toolbar">
        <button
          class="text-button"
          type="button"
          :disabled="aiChat.streaming"
          @click="aiChat.NEW_SESSION()"
        >
          <Plus aria-hidden="true" />
          {{ t('aiChat.panel.newChat') }}
        </button>
      </div>
      <div
        v-if="aiChat.sessions.length === 0"
        class="history-empty"
      >
        {{ t('aiChat.panel.emptySessions') }}
      </div>
      <div
        v-else
        class="history-list"
      >
        <div
          v-for="session in aiChat.sessions"
          :key="session.id"
          class="history-item"
          :class="{ 'is-active': aiChat.activeSession?.id === session.id }"
          role="button"
          @click="aiChat.LOAD_SESSION(session.id)"
        >
          <span class="history-title">{{ session.title || t('aiChat.panel.untitled') }}</span>
          <span class="history-meta">{{ formatTime(session.updatedAt) }}</span>
          <button
            class="history-delete"
            type="button"
            :aria-label="t('aiChat.panel.deleteSession')"
            @click.stop="aiChat.DELETE_SESSION(session.id)"
          >
            <Delete aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div
      ref="messagesEl"
      class="panel-messages"
    >
      <template v-if="activeMessages.length > 0">
        <message-item
          v-for="message in activeMessages"
          :key="message.id"
          :message="message"
          :streaming="aiChat.streaming && message === lastMessage"
        />
      </template>
      <div
        v-else
        class="messages-empty"
      >
        <p>{{ t('aiChat.message.emptyHint') }}</p>
        <p class="messages-empty-sub">
          {{ t('aiChat.message.emptyHintSub') }}
        </p>
      </div>
    </div>

    <composer />
    <settings-dialog />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Clock, Setting, Close, Plus, Delete } from '@element-plus/icons-vue'
import { useAiChatStore } from '@/store/aiChat'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { isMac as isOsx } from '@/util'
import IconTooltip from '@/components/iconTooltip/index.vue'
import MessageItem from './messageItem.vue'
import Composer from './composer.vue'
import SettingsDialog from './settingsDialog.vue'

const { t } = useI18n()
const aiChat = useAiChatStore()
const { activeSession } = storeToRefs(aiChat)

// The fork's window controls hug the viewport top-right in both custom
// titlebar modes — fixed in the tab strip (28px) and absolute inside the
// title bar (--titleBarHeight) — so the panel must start below them.
const layoutStore = useLayoutStore()
const { showTabBar } = storeToRefs(layoutStore)
const preferencesStore = usePreferencesStore()
const { titleBarStyle } = storeToRefs(preferencesStore)
const isFullScreen = ref(false)
const controlsOffset = computed(() => {
  if (isOsx || isFullScreen.value || titleBarStyle.value !== 'custom') return '0px'
  return showTabBar.value ? '28px' : 'var(--titleBarHeight)'
})

let offEnterFullScreen: (() => void) | null = null
let offLeaveFullScreen: (() => void) | null = null
onMounted(() => {
  try {
    void window.electron.windowControl.isFullScreen().then(fs => {
      isFullScreen.value = !!fs
    })
  } catch {
    // Cosmetic offset only; ignore preload API availability errors.
  }
  offEnterFullScreen = window.electron.ipcRenderer.on('mt::window-enter-full-screen', () => {
    isFullScreen.value = true
  })
  offLeaveFullScreen = window.electron.ipcRenderer.on('mt::window-leave-full-screen', () => {
    isFullScreen.value = false
  })
})
onBeforeUnmount(() => {
  offEnterFullScreen?.()
  offLeaveFullScreen?.()
})

const messagesEl = ref<HTMLElement | null>(null)

const activeMessages = computed(() => activeSession.value?.messages ?? [])
const lastMessage = computed(() => {
  const messages = activeMessages.value
  return messages.length > 0 ? messages[messages.length - 1] : null
})

const modelValue = computed(() =>
  `${aiChat.config.activeProviderId}::${aiChat.config.activeModel}`
)

const modelOptions = computed(() =>
  aiChat.config.providers.filter(provider => provider.models.length > 0)
)

const onModelChange = (value: string): void => {
  const [providerId, model] = String(value).split('::')
  void aiChat.UPDATE_CONFIG({
    ...aiChat.config,
    activeProviderId: providerId,
    activeModel: model
  })
}

const formatTime = (timestamp: number): string => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Keep the newest reply in view while tokens stream in.
watch(
  () => [activeMessages.value.length, aiChat.streaming, lastMessage.value?.parts.length],
  () => {
    nextTick(() => {
      const el = messagesEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  }
)

const startResize = (event: MouseEvent): void => {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = aiChat.panelWidth
  const onMove = (moveEvent: MouseEvent): void => {
    aiChat.SET_PANEL_WIDTH(startWidth + (startX - moveEvent.clientX))
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.ai-chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--ai-chat-width);
  width: var(--ai-chat-width);
  height: calc(100% - var(--ai-chat-top-offset, 0px));
  margin-top: var(--ai-chat-top-offset, 0px);
  min-height: 0;
  background: var(--sideBarBgColor);
  border-left: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
  color: var(--sideBarColor);
  font-size: 13px;
}

.drag-bar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 2;
}

.drag-bar:hover {
  background: var(--highlightColor, rgba(0, 120, 212, 0.35));
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
}

.panel-title {
  font-weight: 600;
  white-space: nowrap;
}

.model-select {
  flex: 1;
  min-width: 0;
}

.model-missing {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--deleteColor);
  cursor: pointer;
}

.header-actions {
  display: flex;
  align-items: center;
}

.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sideBarIconColor);
  cursor: pointer;
}

.action-button svg,
.action-button .el-icon {
  width: 16px;
  height: 16px;
}

.action-button:hover,
.action-button.is-active {
  background: var(--sideBarItemHoverBgColor);
  color: var(--sideBarIconColor);
}

.session-history {
  max-height: 220px;
  overflow-y: auto;
  border-bottom: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
}

.history-toolbar {
  padding: 4px 10px;
}

.text-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  color: var(--primaryColor);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 0;
}

.text-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-button svg {
  width: 12px;
  height: 12px;
}

.history-empty,
.messages-empty {
  padding: 16px 10px;
  text-align: center;
  color: var(--sideBarColor);
  opacity: 0.6;
}

.messages-empty-sub {
  font-size: 12px;
  opacity: 0.8;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
}

.history-item:hover,
.history-item.is-active {
  background: var(--sideBarItemHoverBgColor);
}

.history-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  font-size: 11px;
  opacity: 0.6;
  white-space: nowrap;
}

.history-delete {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  color: var(--sideBarIconColor);
  cursor: pointer;
  padding: 2px;
  visibility: hidden;
}

.history-item:hover .history-delete {
  visibility: visible;
}

.history-delete:hover {
  color: var(--deleteColor);
}

.history-delete svg {
  width: 14px;
  height: 14px;
}

.panel-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}
</style>
