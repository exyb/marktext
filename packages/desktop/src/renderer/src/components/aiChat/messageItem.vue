<template>
  <div
    class="chat-message"
    :class="message.role === 'user' ? 'is-user' : 'is-assistant'"
  >
    <div class="message-role">
      <span class="role-label">{{ roleLabel }}</span>
      <span
        v-if="message.role === 'assistant'"
        class="message-actions"
      >
        <button
          v-if="svgFence"
          class="mini-button"
          type="button"
          @click="insertSvg"
        >
          {{ t('aiChat.message.insertSvg') }}
        </button>
        <button
          class="mini-button"
          type="button"
          @click="copyText"
        >
          {{ copied ? t('aiChat.message.copied') : t('aiChat.message.copy') }}
        </button>
      </span>
    </div>

    <!-- User bubbles show the raw prompt; assistant parts render below. -->
    <div
      v-if="message.role === 'user'"
      class="user-bubble"
    >
      {{ textOnly }}
    </div>

    <template v-else>
      <div
        v-for="(part, index) in message.parts"
        :key="index"
        class="message-part"
      >
        <div
          v-if="part.type === 'thinking'"
          class="thinking-block"
        >
          <button
            class="thinking-toggle"
            type="button"
            @click="toggle(index)"
          >
            <span
              class="chevron"
              :class="{ 'is-open': isOpen(index) }"
            >▸</span>
            {{ t('aiChat.message.thinking') }}
            <span
              v-if="streaming && isLast(index)"
              class="thinking-ellipsis"
            >…</span>
          </button>
          <div
            v-show="isOpen(index)"
            class="thinking-body"
          >
            {{ part.text }}
          </div>
        </div>

        <!-- eslint-disable vue/no-v-html -- renderChatMarkdown sanitizes via DOMPurify -->
        <div
          v-else-if="part.type === 'text'"
          class="text-part"
          v-html="renderHtml(part.text)"
        />
        <!-- eslint-enable vue/no-v-html -->

        <div
          v-else-if="part.type === 'tool-call'"
          class="tool-card"
        >
          <div class="tool-card-header">
            <span class="tool-name">{{ toolLabel(part.name) }}</span>
            <span
              class="tool-status"
              :class="statusClass(part)"
            >{{ statusLabel(part) }}</span>
          </div>
          <div class="tool-args">
            <pre>{{ formatArgs(part.args) }}</pre>
          </div>
        </div>

        <div
          v-else-if="part.type === 'tool-result'"
          class="tool-result"
          :class="part.ok ? 'is-ok' : 'is-error'"
        >
          {{ part.result }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiChatMessage, AiMessagePart, AiToolCallPart } from '@shared/types/aiChat'
import { renderChatMarkdown } from '@/ai/markdown'
import { extractSvgFence } from '@/ai/tools'
import { useAiChatStore } from '@/store/aiChat'

const props = defineProps<{
  message: AiChatMessage
  streaming: boolean
}>()

const { t } = useI18n()
const aiChat = useAiChatStore()

const copied = ref(false)
// Manual open/closed overrides; the unset default auto-opens the newest
// thinking section only while its tokens are still streaming in.
const sectionOverrides = ref<Map<number, boolean>>(new Map())

const roleLabel = computed(() =>
  props.message.role === 'user' ? t('aiChat.message.roleUser') : t('aiChat.message.roleAssistant')
)

const textOnly = computed(() =>
  props.message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
)

const svgFence = computed(() =>
  props.message.role === 'assistant' ? extractSvgFence(textOnly.value) : null
)

const renderHtml = (text: string): string => renderChatMarkdown(text)

const isOpen = (index: number): boolean => {
  const override = sectionOverrides.value.get(index)
  if (override !== undefined) return override
  return props.streaming && isLast(index)
}

const toggle = (index: number): void => {
  const next = new Map(sectionOverrides.value)
  next.set(index, !isOpen(index))
  sectionOverrides.value = next
}

const isLast = (index: number): boolean => index === props.message.parts.length - 1

const TOOL_LABEL_KEYS: Record<string, string> = {
  update_document: 'aiChat.tools.updateDocument',
  replace_text: 'aiChat.tools.replaceText',
  insert_svg: 'aiChat.tools.insertSvg'
}

const toolLabel = (name: string): string => {
  const key = TOOL_LABEL_KEYS[name]
  return key ? t(key) : name
}

const resultFor = (call: AiToolCallPart): AiMessagePart | undefined =>
  props.message.parts.find(
    part => part.type === 'tool-result' && part.toolCallId === call.id
  )

const statusClass = (call: AiToolCallPart): string => {
  const result = resultFor(call)
  if (!result || result.type !== 'tool-result') return 'is-running'
  return result.ok ? 'is-ok' : 'is-error'
}

const statusLabel = (call: AiToolCallPart): string => {
  const result = resultFor(call)
  if (!result || result.type !== 'tool-result') return t('aiChat.message.running')
  return result.ok ? t('aiChat.message.success') : t('aiChat.message.failed')
}

const formatArgs = (args: Record<string, unknown>): string => {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

const copyText = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(textOnly.value)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard permission loss is non-actionable here.
  }
}

const insertSvg = (): void => {
  if (!svgFence.value) return
  void aiChat.insertSvgFromMessage(svgFence.value)
}
</script>

<style scoped>
.chat-message {
  margin-bottom: 12px;
}

.message-role {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.role-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--sideBarIconColor);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.8;
}

.message-actions {
  display: inline-flex;
  gap: 6px;
}

.mini-button {
  border: none;
  background: none;
  padding: 0;
  font-size: 11px;
  color: var(--primaryColor);
  cursor: pointer;
}

.user-bubble {
  background: var(--sideBarItemHoverBgColor);
  border-radius: 8px;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 92%;
  margin-left: auto;
}

.message-part {
  margin-top: 4px;
}

.thinking-block {
  border-left: 2px solid var(--sideBarIconColor);
  padding-left: 8px;
  margin: 4px 0;
  opacity: 0.85;
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: var(--sideBarIconColor);
  cursor: pointer;
}

.chevron {
  display: inline-block;
  transition: transform 0.15s ease;
}

.chevron.is-open {
  transform: rotate(90deg);
}

.thinking-ellipsis {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 1;
  }
}

.thinking-body {
  margin-top: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 0.75;
  max-height: 240px;
  overflow-y: auto;
}

.text-part {
  word-break: break-word;
  line-height: 1.55;
}

.text-part :deep(p) {
  margin: 4px 0;
}

.text-part :deep(pre) {
  background: var(--codeBlockBgColor, rgba(128, 128, 128, 0.12));
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  font-size: 12px;
}

.text-part :deep(code) {
  background: var(--codeBlockBgColor, rgba(128, 128, 128, 0.12));
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 12px;
}

.text-part :deep(pre code) {
  background: none;
  padding: 0;
}

.text-part :deep(ul),
.text-part :deep(ol) {
  padding-left: 18px;
  margin: 4px 0;
}

.text-part :deep(a) {
  color: var(--primaryColor);
}

.tool-card {
  border: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  overflow: hidden;
  margin: 4px 0;
}

.tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  background: var(--sideBarItemHoverBgColor);
  font-size: 12px;
}

.tool-name {
  font-weight: 600;
}

.tool-status {
  font-size: 11px;
}

.tool-status.is-running {
  opacity: 0.7;
}

.tool-status.is-ok {
  color: var(--successColor, #67c23a);
}

.tool-status.is-error {
  color: var(--deleteColor);
}

.tool-args {
  max-height: 140px;
  overflow: auto;
  padding: 4px 8px;
}

.tool-args pre {
  margin: 0;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  opacity: 0.75;
}

.tool-result {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--sideBarBorderColor, rgba(128, 128, 128, 0.25));
  border-top: none;
  border-radius: 0 0 6px 6px;
  margin: -4px 0 4px;
}

.tool-result.is-error {
  color: var(--deleteColor);
}
</style>
