<template>
  <div class="flex flex-col pt-2">
    <NAlert type="warning" :show-icon="false">
      <div class="flex items-center gap-2 text-xs leading-relaxed">
        <NIcon class="shrink-0"><WarningIcon /></NIcon>
        <span>{{ t('notice') }}</span>
      </div>
    </NAlert>

    <div class="mt-2 text-xs leading-relaxed text-black/60 dark:text-white/70">
      {{ t('description') }}
    </div>

    <div class="pt-2">
      <SettingsRow
        v-for="target of targets"
        :key="target.id"
        :label-width="160"
        align="center"
        no-x-padding
      >
        <template #label>
          <div class="flex items-center gap-1.5">
            <NIcon><component :is="target.icon" /></NIcon>
            <span>{{ target.label }}</span>
          </div>
        </template>

        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-black/60 dark:text-white/60">{{ t('shortcut') }}</span>
            <ShortcutSelector
              :shortcut-id="shortcuts[target.id]"
              :target-id="shortcutTargetIds[target.id]"
              @update:shortcut-id="(shortcutId) => setShortcut(target.id, shortcutId)"
            />
          </div>
          <NDivider vertical />
          <NPopover :disabled="!sendDisabledReason(target.id)" trigger="hover">
            <template #trigger>
              <NButton
                size="small"
                :disabled="sendDisabledReason(target.id) !== ''"
                @click="handleSend(target.id)"
              >
                <template #icon>
                  <NIcon><SendIcon /></NIcon>
                </template>
                {{ sendButtonText }}
              </NButton>
            </template>
            {{ sendDisabledReason(target.id) }}
          </NPopover>
          <NPopover :disabled="!dryRunDisabledReason()" trigger="hover">
            <template #trigger>
              <NButton
                size="small"
                secondary
                :loading="running"
                :disabled="!!dryRunDisabledReason()"
                @click="dryRun(target.id)"
              >
                <template #icon>
                  <NIcon><DryRunIcon /></NIcon>
                </template>
                {{ t('dryRun') }}
              </NButton>
            </template>
            {{ dryRunDisabledReason() }}
          </NPopover>
        </div>
      </SettingsRow>

      <span hidden aria-hidden="true"></span>
    </div>

    <!-- 生成结果预览 -->
    <PreviewPanel :preset="scope" constrained />

    <!-- 手动查询 -->
    <SettingsRow class="mt-3" :label-width="180" align="center" no-x-padding control-full-line>
      <template #label>
        {{ t('manual.label') }}
      </template>

      <div class="flex w-full items-center gap-2">
        <NInput
          v-model:value="manual.input"
          class="min-w-0 flex-1"
          size="small"
          :placeholder="t('manual.placeholder')"
          :disabled="manualRunning"
          @keydown.enter="runManualEvaluation"
        />
        <NButton
          size="small"
          secondary
          :loading="manualRunning"
          :disabled="!!manualQueryDisabledReason()"
          @click="runManualEvaluation"
        >
          {{ t('manual.query') }}
        </NButton>
      </div>
    </SettingsRow>

    <div v-if="manual.errorMessage" class="mt-1 text-xs text-red-600 dark:text-red-400">
      {{ manual.errorMessage }}
    </div>

    <div
      v-if="manual.entry"
      class="mt-2 rounded border border-black/10 bg-black/5 px-3 py-2 text-xs leading-relaxed dark:border-white/10 dark:bg-white/5"
    >
      <span class="font-bold">{{ manual.entry.displayName }}</span>
      <div v-if="manual.entry.status === 'done'" class="mt-1">{{ manual.entry.text }}</div>
      <div v-else class="mt-1 text-black/50 dark:text-white/50">
        <template v-if="manual.entry.status === 'fetching'">{{
          t('playerStatus.fetching')
        }}</template>
        <template v-else-if="manual.entry.status === 'analyzing'">{{
          t('playerStatus.analyzing')
        }}</template>
        <template v-else-if="manual.entry.status === 'no-data'">{{
          t('playerStatus.noData')
        }}</template>
        <template v-else-if="manual.entry.status === 'error'">{{ manual.errorMessage }}</template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SettingsRow from '@renderer-shared/components/SettingsRow.vue'
import {
  DocumentText24Regular as DryRunIcon,
  Send24Filled as SendIcon,
  Warning24Regular as WarningIcon
} from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'
import { NAlert, NButton, NDivider, NIcon, NInput, NPopover, useMessage } from 'naive-ui'

import PreviewPanel from '../widgets/PreviewPanel.vue'
import ShortcutSelector from '@main-window/components/ShortcutSelector.vue'
import { usePresetTargets } from '../widgets/usePresetTargets'
import { useHorseGrade } from '../horse-grade/use-horse-grade'

const { t } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation' })

const message = useMessage()

const targets = usePresetTargets()

const horseGrade = useHorseGrade()
const scope = horseGrade

const {
  shortcutTargetIds,
  shortcuts,
  setShortcut,
  dryRun,
  gamePhase,
  running,
  generatedLines,
  manual,
  manualRunning,
  runManualEvaluation,
  commonDisabledReason
} = horseGrade

const sendButtonText = computed(() => {
  if (gamePhase.value === 'in-game') {
    return t('sendToGame')
  }

  return t('sendToChat')
})

function sendDisabledReason(targetId: string) {
  if (running.value) {
    return t('reasons.running')
  }

  if (!generatedLines[targetId as keyof typeof generatedLines]) {
    return t('reasons.notReady')
  }

  return ''
}

function manualQueryDisabledReason() {
  if (manualRunning.value) {
    return t('reasons.running')
  }

  return commonDisabledReason()
}

function dryRunDisabledReason() {
  return commonDisabledReason()
}

async function handleSend(target: string) {
  const sent = await horseGrade.send(target as never)

  if (!sent) {
    message.error(t('sendFailed'))
  }
}
</script>
