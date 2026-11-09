<template>
  <div
    ref="composerEl"
    class="chat-composer"
    :class="{ 'is-dragover': dragover }"
    @dragover.stop.prevent="onDragOver"
    @dragleave.stop="dragover = false"
    @drop.stop.prevent="onDrop"
  >
    <div
      v-if="aiChat.references.length > 0"
      class="reference-list"
    >
      <span
        v-for="reference in aiChat.references"
        :key="reference.id"
        class="reference-chip"
        :title="reference.text"
      >
        <span
          v-if="reference.location"
          class="reference-location"
        >{{ reference.location }}</span>
        <span class="reference-text">{{ preview(reference.text) }}</span>
        <button
          class="reference-remove"
          type="button"
          :aria-label="t('aiChat.composer.removeReference')"
          @click="aiChat.REMOVE_REFERENCE(reference.id)"
        >
          <Close aria-hidden="true" />
        </button>
      </span>
    </div>

    <el-input
      v-model="draft"
      class="composer-input"
      type="textarea"
      resize="none"
      :autosize="{ minRows: 2, maxRows: 7 }"
      :placeholder="placeholder"
      @keydown.enter.exact.prevent="send"
    />

    <div class="composer-footer">
      <el-checkbox
        v-model="docContext"
        size="small"
        :disabled="aiChat.streaming"
      >
        {{ t('aiChat.composer.attachDoc') }}
      </el-checkbox>
      <span class="composer-hint">{{ t('aiChat.composer.dropHint') }}</span>

      <el-button
        v-if="aiChat.streaming"
        class="send-button"
        type="danger"
        size="small"
        circle
        :aria-label="t('aiChat.composer.stop')"
        :title="t('aiChat.composer.stop')"
        @click="aiChat.ABORT()"
      >
        <VideoPause aria-hidden="true" />
      </el-button>
      <el-button
        v-else
        class="send-button"
        type="primary"
        size="small"
        circle
        :aria-label="t('aiChat.composer.send')"
        :title="t('aiChat.composer.send')"
        :disabled="!draft.trim()"
        @click="send"
      >
        <Promotion aria-hidden="true" />
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Close, Promotion, VideoPause } from '@element-plus/icons-vue'
import bus from '@/bus'
import { useAiChatStore } from '@/store/aiChat'

const { t } = useI18n()
const aiChat = useAiChatStore()
const { docContextEnabled } = storeToRefs(aiChat)

const draft = ref('')
const dragover = ref(false)

const composerEl = ref<HTMLElement | null>(null)

// muya's text drag is a custom gesture (native dragstart is suppressed), so
// editor selections reach the composer as bus events with cursor coordinates.
const containsPoint = (clientX: number, clientY: number): boolean => {
  const el = composerEl.value
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}

// Live pointer tracking highlights the drop zone while the gesture passes over
// the composer; muya emits one event per pointer move during the drag.
const onAiTextDragMove = (payload: unknown): void => {
  if (typeof payload !== 'object' || payload === null) return
  const point = payload as { clientX?: unknown; clientY?: unknown }
  if (typeof point.clientX !== 'number' || typeof point.clientY !== 'number') return
  dragover.value = containsPoint(point.clientX, point.clientY)
}

const onAiTextDragEnd = (): void => {
  dragover.value = false
}

// "¶N" locates the block the quote came from so the user can tell which
// paragraph a chip refers to; cross-block quotes report the span.
const formatDragRange = (range: unknown): string | undefined => {
  if (typeof range !== 'object' || range === null) return undefined
  const { startBlockIndex, endBlockIndex } = range as {
    startBlockIndex?: unknown
    endBlockIndex?: unknown
  }
  if (typeof startBlockIndex !== 'number' || startBlockIndex < 0) return undefined
  const start = startBlockIndex + 1
  const end =
    typeof endBlockIndex === 'number' && endBlockIndex >= 0 ? endBlockIndex + 1 : start
  return end > start ? `¶${start}–¶${end}` : `¶${start}`
}

const onAiTextDrop = (payload: unknown): void => {
  if (typeof payload !== 'object' || payload === null) return
  const drop = payload as {
    text?: unknown
    clientX?: unknown
    clientY?: unknown
    range?: unknown
  }
  if (typeof drop.text !== 'string' || !drop.text.trim()) return
  if (typeof drop.clientX !== 'number' || typeof drop.clientY !== 'number') return
  if (!containsPoint(drop.clientX, drop.clientY)) return
  aiChat.ADD_REFERENCE(drop.text, formatDragRange(drop.range))
}

onMounted(() => {
  bus.on('ai-text-drop', onAiTextDrop)
  bus.on('ai-text-drag-move', onAiTextDragMove)
  bus.on('ai-text-drag-end', onAiTextDragEnd)
})
onBeforeUnmount(() => {
  bus.off('ai-text-drop', onAiTextDrop)
  bus.off('ai-text-drag-move', onAiTextDragMove)
  bus.off('ai-text-drag-end', onAiTextDragEnd)
})

const docContext = computed({
  get: () => docContextEnabled.value,
  set: value => {
    docContextEnabled.value = value
  }
})

const placeholder = computed(() => t('aiChat.composer.placeholder'))

const preview = (text: string): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > 40 ? `${singleLine.slice(0, 40)}…` : singleLine
}

const onDragOver = (event: DragEvent): void => {
  // Only text drags (editor selections) are handled; file drags keep the
  // window-level import flow.
  if (!event.dataTransfer?.types.includes('text/plain')) return
  dragover.value = true
}

const onDrop = (event: DragEvent): void => {
  dragover.value = false
  const text = event.dataTransfer?.getData('text/plain')
  if (!text) return
  aiChat.ADD_REFERENCE(text)
}

const send = (): void => {
  const prompt = draft.value
  if (!prompt.trim() || aiChat.streaming) return
  draft.value = ''
  void aiChat.SEND_PROMPT(prompt)
}
</script>

<style scoped>
.chat-composer {
  border-top: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
  padding: 8px 10px;
}

.chat-composer.is-dragover {
  outline: 2px dashed var(--focusColor, var(--themeColor));
  outline-offset: -4px;
}

.reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.reference-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  background: var(--sideBarItemHoverBgColor);
  border: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 11px;
}

.reference-location {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--sideBarIconColor);
  opacity: 0.75;
}

.reference-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 0;
  color: var(--sideBarIconColor);
  cursor: pointer;
}

.reference-remove svg {
  width: 10px;
  height: 10px;
}

.composer-input {
  font-size: 13px;
}

.composer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.composer-hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--sideBarIconColor);
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-button {
  flex-shrink: 0;
}

.send-button svg {
  width: 14px;
  height: 14px;
}
</style>
