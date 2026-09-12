<template>
  <div
    class="relative overflow-hidden rounded border px-4 py-3 transition-colors"
    :class="
      isActive
        ? 'border-akari-500/40 bg-akari-500/10 dark:bg-akari-500/15'
        : 'border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5'
    "
  >
    <div
      v-if="isActive"
      class="bg-akari-500 absolute inset-y-0 left-0 w-1 rounded-l"
      aria-hidden="true"
    ></div>

    <div class="flex items-center gap-2">
      <NTag size="small" round :bordered="false" :type="protocolTagType">
        {{ t(`aiModel.protocol.${config.protocol}`) }}
      </NTag>
      <span class="truncate font-bold">{{ config.name }}</span>
      <span v-if="config.note" class="min-w-0 truncate text-xs text-black/50 dark:text-white/50">
        {{ config.note }}
      </span>
      <div class="flex-1"></div>
      <NTag v-if="isActive" size="small" round type="primary">
        {{ t('aiModel.config.active') }}
      </NTag>
      <NButton v-else size="tiny" secondary :focusable="false" @click="emit('setActive')">
        {{ t('aiModel.config.setActive') }}
      </NButton>
    </div>

    <div
      class="mt-2 flex items-center gap-2 overflow-hidden text-xs text-black/60 dark:text-white/60"
    >
      <span class="shrink-0 font-mono">{{ config.modelId }}</span>
      <span class="opacity-40">|</span>
      <span class="truncate font-mono">{{ config.baseUrl }}</span>
    </div>

    <div class="mt-3 flex items-center gap-2">
      <NButton size="tiny" secondary :focusable="false" :loading="testing" @click="emit('test')">
        {{ t('aiModel.config.test') }}
      </NButton>
      <NButton size="tiny" secondary :focusable="false" @click="emit('edit')">
        {{ t('aiModel.config.edit') }}
      </NButton>
      <NPopconfirm @positive-click="emit('remove')">
        <template #trigger>
          <NButton size="tiny" secondary type="error" :focusable="false">
            {{ t('aiModel.config.delete') }}
          </NButton>
        </template>
        {{ t('aiModel.config.deleteConfirm') }}
      </NPopconfirm>
    </div>

    <div v-if="testResult" class="mt-2 border-t border-black/10 pt-2 text-xs dark:border-white/10">
      <template v-if="testResult.ok">
        <span class="text-green-600 dark:text-green-400">
          {{ t('aiModel.config.testResult.success', { durationMs: testResult.durationMs }) }}
        </span>
        <span
          v-if="testResult.replyPreview"
          class="ml-2 break-all text-black/55 dark:text-white/55"
        >
          {{ t('aiModel.config.testResult.reply', { reply: testResult.replyPreview }) }}
        </span>
      </template>
      <template v-else>
        <span class="text-red-600 dark:text-red-400">
          {{
            t('aiModel.config.testResult.failureReason', {
              reason: t(FAILURE_REASON_KEYS[testResult.reason])
            })
          }}
        </span>
        <span v-if="testResult.message" class="ml-2 break-all text-black/55 dark:text-white/55">
          {{ testResult.message }}
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AiModelConfig, AiModelTestResult } from '@shared/shards/ai-model'
import { useTranslation } from 'i18next-vue'
import { NButton, NPopconfirm, NTag } from 'naive-ui'
import { computed } from 'vue'

import { AI_MODEL_FAILURE_REASON_KEYS as FAILURE_REASON_KEYS } from '../failure-reasons'

const props = defineProps<{
  config: AiModelConfig
  isActive: boolean
  testing: boolean
  testResult: AiModelTestResult | undefined
}>()

const emit = defineEmits<{
  setActive: []
  test: []
  edit: []
  remove: []
}>()

const { t } = useTranslation()

const protocolTagType = computed(() => (props.config.protocol === 'anthropic' ? 'info' : 'default'))
</script>
