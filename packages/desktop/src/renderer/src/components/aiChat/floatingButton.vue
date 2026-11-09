<template>
  <button
    v-show="!aiChat.panelOpen"
    class="ai-chat-fab"
    type="button"
    :aria-label="t('aiChat.panel.title')"
    :title="t('aiChat.panel.title')"
    @click="aiChat.TOGGLE_PANEL()"
  >
    <ChatDotRound aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChatDotRound } from '@element-plus/icons-vue'
import { useAiChatStore } from '@/store/aiChat'

const { t } = useI18n()
const aiChat = useAiChatStore()
</script>

<style scoped>
.ai-chat-fab {
  position: fixed;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  z-index: 100;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--buttonBorder, transparent);
  background: var(--floatBgColor, var(--sideBarBgColor));
  color: var(--primaryColor);
  box-shadow: var(--floatShadow, 0 2px 8px rgba(0, 0, 0, 0.2));
  cursor: pointer;
}

.ai-chat-fab:hover {
  background: var(--buttonBgColorHover, var(--floatHoverColor, var(--sideBarBgColor)));
}

.ai-chat-fab svg {
  width: 18px;
  height: 18px;
}
</style>
