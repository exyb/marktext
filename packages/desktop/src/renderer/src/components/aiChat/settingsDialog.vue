<template>
  <el-dialog
    v-model="visible"
    :title="t('aiChat.settings.title')"
    width="500px"
    append-to-body
    custom-class="ag-dialog-table"
  >
    <div class="settings-body">
      <div class="provider-picker">
        <el-select
          v-model="draftProviderId"
          size="small"
          :placeholder="t('aiChat.settings.provider')"
          class="provider-select"
        >
          <el-option
            v-for="provider in draft.providers"
            :key="provider.id"
            :label="provider.name"
            :value="provider.id"
          />
        </el-select>
        <el-button
          size="small"
          @click="addProvider"
        >
          {{ t('aiChat.settings.addProvider') }}
        </el-button>
        <el-button
          size="small"
          type="danger"
          plain
          :disabled="!draftProviderId"
          @click="removeProvider"
        >
          {{ t('aiChat.settings.deleteProvider') }}
        </el-button>
      </div>

      <template v-if="draftProvider">
        <el-form
          label-width="96px"
          size="small"
          class="provider-form"
        >
          <el-form-item :label="t('aiChat.settings.name')">
            <el-input
              v-model="draftProvider.name"
              :placeholder="t('aiChat.settings.name')"
            />
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.type')">
            <el-select v-model="draftProvider.type">
              <el-option
                label="OpenAI Compatible"
                value="openai-compatible"
              />
              <el-option
                label="Anthropic"
                value="anthropic"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.baseUrl')">
            <el-input
              v-model="draftProvider.baseUrl"
              :placeholder="baseUrlPlaceholder"
            />
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.apiKey')">
            <el-input
              v-model="draftProvider.apiKey"
              type="password"
              show-password
              :placeholder="t('aiChat.settings.apiKey')"
            />
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.models')">
            <div class="models-row">
              <el-input
                v-model="modelsText"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 6 }"
                :placeholder="t('aiChat.settings.modelsPlaceholder')"
              />
              <el-button
                size="small"
                :loading="fetchingModels"
                :disabled="!draftProvider.baseUrl"
                @click="fetchModels"
              >
                {{ t('aiChat.settings.fetchModels') }}
              </el-button>
            </div>
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.contextTokens')">
            <el-input-number
              v-model="draftProvider.contextTokens"
              :min="1024"
              :max="10000000"
              :step="1024"
              :placeholder="t('aiChat.settings.defaultValue')"
              controls-position="right"
              class="param-input"
            />
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.maxOutputTokens')">
            <el-input-number
              v-model="draftProvider.maxOutputTokens"
              :min="16"
              :max="1000000"
              :step="256"
              :placeholder="t('aiChat.settings.defaultValue')"
              controls-position="right"
              class="param-input"
            />
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.temperature')">
            <el-input-number
              v-model="draftProvider.temperature"
              :min="0"
              :max="2"
              :step="0.1"
              :precision="1"
              :placeholder="t('aiChat.settings.defaultValue')"
              controls-position="right"
              class="param-input"
            />
          </el-form-item>
          <el-form-item :label="t('aiChat.settings.testConnection')">
            <div class="test-row">
              <el-select
                v-model="testModelId"
                size="small"
                class="test-model-select"
                :placeholder="t('aiChat.composer.pickModel')"
                :disabled="draftProvider.models.length === 0"
              >
                <el-option
                  v-for="model in draftProvider.models"
                  :key="model"
                  :label="model"
                  :value="model"
                />
              </el-select>
              <el-button
                size="small"
                type="primary"
                plain
                :loading="testing"
                :disabled="draftProvider.models.length === 0"
                @click="testModel"
              >
                {{ t('aiChat.settings.testConnection') }}
              </el-button>
            </div>
            <div
              v-if="testResult"
              class="test-result"
              :class="testResult.ok ? 'is-ok' : 'is-error'"
            >
              <template v-if="testResult.ok">
                {{ t('aiChat.settings.testOk', { latency: testResult.latencyMs }) }} —
                {{ testResult.detail }}
              </template>
              <template v-else>
                {{ testResult.error }}
              </template>
            </div>
          </el-form-item>
        </el-form>
      </template>
      <div
        v-else
        class="no-provider"
      >
        {{ t('aiChat.settings.noProvider') }}
      </div>

      <el-form
        label-width="96px"
        size="small"
        class="global-form"
      >
        <el-form-item :label="t('aiChat.settings.thinkingLevel')">
          <el-select
            v-model="draft.thinkingLevel"
            :disabled="!draftProvider"
          >
            <el-option
              :label="t('aiChat.settings.thinkingOff')"
              value="off"
            />
            <el-option
              :label="t('aiChat.settings.thinkingLow')"
              value="low"
            />
            <el-option
              :label="t('aiChat.settings.thinkingMedium')"
              value="medium"
            />
            <el-option
              :label="t('aiChat.settings.thinkingHigh')"
              value="high"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button
        size="small"
        @click="visible = false"
      >
        {{ t('aiChat.settings.cancel') }}
      </el-button>
      <el-button
        size="small"
        type="primary"
        :loading="saving"
        @click="save"
      >
        {{ t('aiChat.settings.save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type {
  AiChatConfig,
  AiModelProbeResult,
  AiProviderConfig
} from '@shared/types/aiChat'
import { useAiChatStore } from '@/store/aiChat'

const { t } = useI18n()
const aiChat = useAiChatStore()

const visible = computed({
  get: () => aiChat.settingsVisible,
  set: value => {
    aiChat.settingsVisible = value
  }
})

const emptyDraft = (): AiChatConfig => ({
  providers: [],
  activeProviderId: '',
  activeModel: '',
  thinkingLevel: 'off'
})

const draft = ref<AiChatConfig>(emptyDraft())
const draftProviderId = ref('')
const fetchingModels = ref(false)
const testing = ref(false)
const saving = ref(false)
const testModelId = ref('')
const testResult = ref<AiModelProbeResult | null>(null)

// The dialog edits a deep copy; saving publishes it in one UPDATE_CONFIG call.
watch(visible, isOpen => {
  if (!isOpen) return
  draft.value = JSON.parse(JSON.stringify(aiChat.config)) as AiChatConfig
  draftProviderId.value = aiChat.config.activeProviderId || aiChat.config.providers[0]?.id || ''
  testResult.value = null
  testModelId.value = aiChat.config.activeModel
})

const draftProvider = computed(() =>
  draft.value.providers.find(provider => provider.id === draftProviderId.value)
)

const modelsText = computed({
  get: () => draftProvider.value?.models.join('\n') ?? '',
  set: value => {
    if (!draftProvider.value) return
    draftProvider.value.models = value
      .split(/\r?\n|,/)
      .map(model => model.trim())
      .filter(Boolean)
  }
})

const baseUrlPlaceholder = computed(() =>
  draftProvider.value?.type === 'anthropic'
    ? 'https://api.anthropic.com'
    : 'https://api.openai.com/v1'
)

const createProviderId = (): string => `provider-${Date.now().toString(36)}`

const addProvider = (): void => {
  const provider: AiProviderConfig = {
    id: createProviderId(),
    name: t('aiChat.settings.defaultProviderName'),
    type: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    models: []
  }
  draft.value.providers.push(provider)
  draftProviderId.value = provider.id
}

const removeProvider = (): void => {
  draft.value.providers = draft.value.providers.filter(
    provider => provider.id !== draftProviderId.value
  )
  if (draft.value.activeProviderId === draftProviderId.value) {
    draft.value.activeProviderId = ''
    draft.value.activeModel = ''
  }
  draftProviderId.value = draft.value.providers[0]?.id ?? ''
}

const fetchModels = async (): Promise<void> => {
  const provider = draftProvider.value
  if (!provider || !provider.baseUrl || fetchingModels.value) return
  fetchingModels.value = true
  try {
    const result = await window.aiChat.fetchModels({
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey
    })
    if (result.ok) {
      // Keep the authoring order and append newly discovered ids.
      const known = new Set(provider.models)
      const added = result.models.filter(model => !known.has(model))
      provider.models = [...provider.models, ...added]
      ElMessage.success(t('aiChat.settings.fetchModelsDone', { count: added.length }))
    } else {
      ElMessage.error(`${t('aiChat.settings.fetchModelsFailed')}: ${result.error}`)
    }
  } catch (error) {
    ElMessage.error(`${t('aiChat.settings.fetchModelsFailed')}: ${String(error)}`)
  } finally {
    fetchingModels.value = false
  }
}

const testModel = async (): Promise<void> => {
  const provider = draftProvider.value
  if (!provider || testing.value) return
  const model = testModelId.value || provider.models[0]
  if (!model) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await window.aiChat.testModel({
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model
    })
  } catch (error) {
    testResult.value = { ok: false, error: String(error) }
  } finally {
    testing.value = false
  }
}

const save = async (): Promise<void> => {
  const activeProvider = draft.value.providers.find(
    provider => provider.id === draftProviderId.value
  )
  if (activeProvider) {
    draft.value.activeProviderId = activeProvider.id
    if (!activeProvider.models.includes(draft.value.activeModel)) {
      draft.value.activeModel = activeProvider.models[0] ?? ''
    }
  } else {
    draft.value.activeProviderId = ''
    draft.value.activeModel = ''
  }
  saving.value = true
  const error = await aiChat.UPDATE_CONFIG(draft.value)
  saving.value = false
  if (error === null) {
    ElMessage.success(t('aiChat.settings.saved'))
    visible.value = false
  } else {
    ElMessage.error(`${t('aiChat.settings.saveFailed')}: ${error}`)
  }
}
</script>

<style scoped>
.settings-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-picker {
  display: flex;
  gap: 8px;
  align-items: center;
}

.provider-select {
  flex: 1;
}

.provider-form :deep(.el-select),
.global-form :deep(.el-select) {
  width: 100%;
}

.models-row {
  display: flex;
  gap: 8px;
  width: 100%;
  align-items: flex-start;
}

.models-row .el-textarea {
  flex: 1;
}

.test-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.test-model-select {
  flex: 1;
}

.test-result {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  word-break: break-all;
}

.test-result.is-ok {
  color: var(--successColor, #67c23a);
}

.test-result.is-error {
  color: var(--deleteColor);
}

.param-input {
  width: 180px;
}

.no-provider {
  padding: 18px 0;
  text-align: center;
  color: var(--sideBarIconColor);
  opacity: 0.7;
}
</style>
