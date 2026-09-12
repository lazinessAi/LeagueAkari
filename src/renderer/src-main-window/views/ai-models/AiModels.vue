<template>
  <div class="relative h-full">
    <NScrollbar class="h-full" :theme-overrides="{ width: '8px' }">
      <div class="mx-auto w-full max-w-200 px-6 pt-10 pb-8">
        <div class="mb-6 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-xl font-bold">{{ t('aiModel.title') }}</div>
            <div class="mt-1 text-sm text-black/55 dark:text-white/55">
              {{ t('aiModel.description') }}
            </div>
          </div>
          <NButton type="primary" :focusable="false" @click="openCreateDrawer">
            {{ t('aiModel.createConfig') }}
          </NButton>
        </div>

        <NEmpty
          v-if="store.settings.configs.length === 0"
          class="py-24"
          :description="t('aiModel.empty.description')"
        >
          <template #extra>
            <NButton type="primary" secondary :focusable="false" @click="openCreateDrawer">
              {{ t('aiModel.empty.create') }}
            </NButton>
          </template>
        </NEmpty>

        <div v-else class="flex flex-col gap-3">
          <AiModelConfigCard
            v-for="config in store.settings.configs"
            :key="config.id"
            :config="config"
            :is-active="config.id === store.settings.activeConfigId"
            :testing="testingConfigIds.has(config.id)"
            :test-result="testResults[config.id]"
            @set-active="handleSetActive(config)"
            @test="handleTest(config)"
            @edit="openEditDrawer(config)"
            @remove="handleDelete(config)"
          />
        </div>
      </div>
    </NScrollbar>

    <NDrawer v-model:show="showEditDrawer" width="min(460px, calc(100% - 48px))">
      <NDrawerContent
        :title="isNewConfig ? t('aiModel.form.createTitle') : t('aiModel.form.editTitle')"
        closable
        :native-scrollbar="false"
      >
        <NForm ref="formRef" :model="draft" :rules="formRules" label-placement="top">
          <NFormItem :label="t('aiModel.form.name')" path="name">
            <NInput v-model:value="draft.name" :placeholder="t('aiModel.form.namePlaceholder')" />
          </NFormItem>

          <NFormItem :label="t('aiModel.form.protocol')" path="protocol">
            <NRadioGroup v-model:value="draft.protocol">
              <NRadioButton value="openai">{{ t('aiModel.protocol.openai') }}</NRadioButton>
              <NRadioButton value="anthropic">{{ t('aiModel.protocol.anthropic') }}</NRadioButton>
            </NRadioGroup>
          </NFormItem>

          <NFormItem :label="t('aiModel.form.baseUrl')" path="baseUrl">
            <div class="w-full">
              <NInput v-model:value="draft.baseUrl" :placeholder="baseUrlPlaceholder" />
              <div class="mt-1 text-xs text-black/45 dark:text-white/45">
                {{ t('aiModel.form.baseUrlHint') }}
              </div>
            </div>
          </NFormItem>

          <NFormItem :label="t('aiModel.form.apiKey')" path="apiKey">
            <NInput
              v-model:value="draft.apiKey"
              type="password"
              show-password-on="click"
              :placeholder="t('aiModel.form.apiKeyPlaceholder')"
            />
          </NFormItem>

          <NFormItem :label="t('aiModel.form.modelId')" path="modelId">
            <div class="w-full">
              <div class="flex items-center gap-2">
                <NSelect
                  v-model:value="draft.modelId"
                  class="min-w-0 flex-1"
                  filterable
                  tag
                  clearable
                  :options="modelOptions"
                  :placeholder="t('aiModel.form.modelIdPlaceholder')"
                />
                <NButton
                  shrink-0
                  secondary
                  :focusable="false"
                  :loading="fetchingModels"
                  @click="handleFetchModels"
                >
                  {{ t('aiModel.fetchModels.button') }}
                </NButton>
              </div>
              <div
                v-if="modelsFeedback"
                class="mt-1 text-xs break-all"
                :class="
                  modelsFeedback.ok
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                "
              >
                {{ modelsFeedback.text }}
              </div>
            </div>
          </NFormItem>

          <NFormItem :label="t('aiModel.form.note')" path="note">
            <NInput v-model:value="draft.note" :placeholder="t('aiModel.form.notePlaceholder')" />
          </NFormItem>
        </NForm>

        <template #footer>
          <div class="flex justify-end gap-2">
            <NButton :focusable="false" @click="showEditDrawer = false">
              {{ t('aiModel.form.cancel') }}
            </NButton>
            <NButton type="primary" :focusable="false" @click="handleSave">
              {{ t('aiModel.form.save') }}
            </NButton>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { AiModelRenderer } from '@renderer-shared/shards/ai-model'
import { useAiModelStore } from '@renderer-shared/shards/ai-model/store'
import {
  type AiModelConfig,
  type AiModelProtocol,
  type AiModelTestResult,
  createDefaultAiModelConfig,
  getDefaultAiModelBaseUrl,
  isDefaultAiModelBaseUrl,
  normalizeAiModelBaseUrl
} from '@shared/shards/ai-model'
import { useTranslation } from 'i18next-vue'
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NRadioButton,
  NRadioGroup,
  NScrollbar,
  NSelect,
  type FormInst,
  type FormRules
} from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'

import AiModelConfigCard from './components/AiModelConfigCard.vue'
import { AI_MODEL_FAILURE_REASON_KEYS as FAILURE_REASON_KEYS } from './failure-reasons'

interface AiModelConfigDraft {
  id: string
  name: string
  protocol: AiModelProtocol
  baseUrl: string
  apiKey: string
  modelId: string | null
  note: string
}

const { t } = useTranslation()

const aiModel = useInstance(AiModelRenderer)
const store = useAiModelStore()

const showEditDrawer = ref(false)
const isNewConfig = ref(false)
const draft = ref<AiModelConfigDraft>({ ...createDefaultAiModelConfig(), modelId: null })
const formRef = ref<FormInst>()

const modelOptions = ref<{ label: string; value: string }[]>([])
const fetchingModels = ref(false)
const modelsFeedback = ref<{ ok: boolean; text: string } | null>(null)

const testResults = ref<Record<string, AiModelTestResult>>({})
const testingConfigIds = reactive(new Set<string>())

const baseUrlPlaceholder = computed(() =>
  t(`aiModel.form.baseUrlPlaceholder.${draft.value.protocol}`)
)

const formRules = computed<FormRules>(() => ({
  name: {
    required: true,
    trigger: ['blur', 'input'],
    message: t('aiModel.form.validation.nameRequired')
  },
  baseUrl: {
    required: true,
    trigger: ['blur', 'input'],
    message: t('aiModel.form.validation.baseUrlRequired')
  },
  modelId: {
    required: true,
    trigger: ['blur', 'change'],
    validator: () =>
      (draft.value.modelId ?? '').trim().length > 0
        ? true
        : new Error(t('aiModel.form.validation.modelIdRequired'))
  }
}))

// 切换协议时，若 API 地址仍是原协议的官方默认值，则自动替换为新协议的默认值
watch(
  () => draft.value.protocol,
  (nextProtocol, previousProtocol) => {
    if (previousProtocol && isDefaultAiModelBaseUrl(draft.value.baseUrl, previousProtocol)) {
      draft.value.baseUrl = getDefaultAiModelBaseUrl(nextProtocol)
    }
  }
)

function openCreateDrawer() {
  isNewConfig.value = true
  draft.value = { ...createDefaultAiModelConfig(), id: crypto.randomUUID(), modelId: null }
  resetDrawerTransientState()
  showEditDrawer.value = true
}

function openEditDrawer(config: AiModelConfig) {
  isNewConfig.value = false
  draft.value = { ...config, modelId: config.modelId }
  resetDrawerTransientState()
  showEditDrawer.value = true
}

function resetDrawerTransientState() {
  modelOptions.value = draft.value.modelId
    ? [{ label: draft.value.modelId, value: draft.value.modelId }]
    : []
  modelsFeedback.value = null
  formRef.value?.restoreValidation()
}

async function handleSave() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  const savedConfig: AiModelConfig = {
    id: draft.value.id,
    name: draft.value.name.trim(),
    protocol: draft.value.protocol,
    baseUrl: normalizeAiModelBaseUrl(draft.value.baseUrl),
    apiKey: draft.value.apiKey.trim(),
    modelId: (draft.value.modelId ?? '').trim(),
    note: draft.value.note.trim()
  }

  const nextConfigs = isNewConfig.value
    ? [...store.settings.configs, savedConfig]
    : store.settings.configs.map((config) => (config.id === savedConfig.id ? savedConfig : config))

  await aiModel.setConfigs(nextConfigs)
  showEditDrawer.value = false
}

async function handleSetActive(config: AiModelConfig) {
  await aiModel.setActiveConfigId(config.id)
}

async function handleDelete(config: AiModelConfig) {
  await aiModel.setConfigs(store.settings.configs.filter((entry) => entry.id !== config.id))

  if (store.settings.activeConfigId === config.id) {
    await aiModel.setActiveConfigId(null)
  }

  if (testResults.value[config.id]) {
    const nextResults = { ...testResults.value }
    delete nextResults[config.id]
    testResults.value = nextResults
  }
}

async function handleTest(config: AiModelConfig) {
  testingConfigIds.add(config.id)

  try {
    const result = await aiModel.testConfig(config)
    testResults.value = { ...testResults.value, [config.id]: result }
  } catch (error) {
    testResults.value = {
      ...testResults.value,
      [config.id]: { ok: false, reason: 'unknown', message: String(error) }
    }
  } finally {
    testingConfigIds.delete(config.id)
  }
}

async function handleFetchModels() {
  fetchingModels.value = true
  modelsFeedback.value = null

  try {
    const result = await aiModel.fetchModelList({
      ...draft.value,
      modelId: draft.value.modelId ?? ''
    })

    if (result.ok) {
      modelOptions.value = result.models.map((modelId) => ({ label: modelId, value: modelId }))
      modelsFeedback.value = {
        ok: true,
        text: t('aiModel.fetchModels.succeeded', { count: result.models.length })
      }
    } else {
      modelsFeedback.value = {
        ok: false,
        text: t('aiModel.fetchModels.failedReason', {
          reason: `${t(FAILURE_REASON_KEYS[result.reason])} ${result.message}`.trim()
        })
      }
    }
  } catch {
    modelsFeedback.value = {
      ok: false,
      text: t('aiModel.fetchModels.failedReason', {
        reason: t('aiModel.config.testResult.reason.unknown')
      })
    }
  } finally {
    fetchingModels.value = false
  }
}
</script>
