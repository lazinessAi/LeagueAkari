<template>
  <div class="flex flex-col pt-2">
    <div class="text-xs leading-relaxed text-black/60 dark:text-white/70">
      {{ t('description') }}
    </div>

    <SettingsRow
      v-for="target of targets"
      :key="target.id"
      :label-width="160"
      :label-description="targetDescription(target)"
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
            :shortcut-id="igsStore.settings.aiEvaluationTargetShortcuts[target.id]"
            :target-id="getShortcutTargetId(target.id)"
            @update:shortcut-id="(id) => setShortcut(target.id, id)"
          />
        </div>
        <NDivider vertical />
        <NPopover :disabled="!getTargetSendDisabledReason(target.id)" trigger="hover">
          <template #trigger>
            <NButton
              size="small"
              :disabled="getTargetSendDisabledReason(target.id) !== ''"
              @click="handleSendTarget(target.id)"
            >
              <template #icon>
                <NIcon><SendIcon /></NIcon>
              </template>
              {{ t('sendToChat') }}
            </NButton>
          </template>
          {{ getTargetSendDisabledReason(target.id) }}
        </NPopover>

        <NPopover :disabled="!targetDryRunDisabledReason(target.id)" trigger="hover">
          <template #trigger>
            <NButton
              size="small"
              secondary
              :loading="rows[target.id].status === 'running'"
              :disabled="!!targetDryRunDisabledReason(target.id)"
              @click="runTargetEvaluation(target.id)"
            >
              <template #icon>
                <NIcon><DryRunIcon /></NIcon>
              </template>
              {{ t('dryRun') }}
            </NButton>
          </template>
          {{ targetDryRunDisabledReason(target.id) }}
        </NPopover>
      </div>
    </SettingsRow>

    <!-- Keep the final row divider when content follows this group. -->
    <span hidden aria-hidden="true"></span>

    <NameDisplayStrategySelector
      :value="igsStore.settings.aiEvaluationNameDisplayStrategy"
      @update:value="(strategy) => igs.setAiEvaluationNameDisplayStrategy(strategy)"
    />

    <!-- 发送的目标：按玩家勾选 -->
    <div v-if="allGamePlayers.length" class="mt-1 flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <div class="text-xs font-semibold text-black/70 dark:text-white/70">
          {{
            tSelection('playersTitle', {
              selected: selectedGamePlayerCount,
              total: allGamePlayers.length
            })
          }}
        </div>
        <div class="flex items-center gap-1">
          <NButton size="tiny" quaternary :focusable="false" @click="setAllPlayersSelected(true)">
            {{ tSelection('selectAll') }}
          </NButton>
          <NButton size="tiny" quaternary :focusable="false" @click="setAllPlayersSelected(false)">
            {{ tSelection('clear') }}
          </NButton>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div
          v-for="group of playerGroups"
          :key="group.label"
          class="rounded border border-black/10 bg-black/3 p-2 dark:border-white/10 dark:bg-white/3"
        >
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-xs font-semibold">
              <span>{{ group.label }}</span>
              <span class="font-normal text-black/45 dark:text-white/45">
                ({{ group.selectedCount }}/{{ group.members.length }})
              </span>
            </div>
            <NCheckbox
              size="small"
              :checked="group.selectedCount === group.members.length"
              :indeterminate="group.selectedCount > 0 && group.selectedCount < group.members.length"
              @update:checked="(checked) => setGroupSelected(group, checked)"
            >
              <span class="text-[11px] text-black/55 dark:text-white/55">
                {{ tSelection('selectAll') }}
              </span>
            </NCheckbox>
          </div>

          <div class="flex flex-col gap-1.5">
            <div
              v-for="player of group.members"
              :key="player.puuid"
              class="flex cursor-pointer items-center gap-2"
              @click="setPlayerSelected(player.puuid, !isPlayerSelected(player.puuid))"
            >
              <NCheckbox
                size="small"
                :checked="isPlayerSelected(player.puuid)"
                @update:checked="(checked) => setPlayerSelected(player.puuid, checked)"
                @click.stop
              />
              <ChampionIcon
                v-if="player.championId"
                class="size-5 shrink-0"
                round
                :champion-id="player.championId"
              />
              <LcuImage
                v-else-if="player.profileIconId !== null"
                class="size-5 shrink-0 rounded-full"
                :src="profileIconUri(player.profileIconId)"
              />
              <div class="flex min-w-0 flex-1 items-baseline gap-0.5 text-[12px] leading-none">
                <template v-if="!as.settings.streamerMode">
                  <span class="truncate font-medium text-black/85 dark:text-white/85">
                    {{ player.gameName || player.name }}
                  </span>
                  <span
                    v-if="player.tagLine"
                    class="shrink-0 text-[11px] text-black/50 dark:text-white/50"
                  >
                    #{{ player.tagLine }}
                  </span>
                </template>
                <span v-else class="truncate font-medium text-black/85 dark:text-white/85">
                  {{ maskedName(player.name) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 评价结果 -->
    <div class="mt-3 flex flex-col gap-2">
      <template v-for="target of targets" :key="target.id">
        <div v-if="rows[target.id].evaluations.length" class="flex flex-col gap-1.5">
          <div class="text-xs font-bold text-black/70 dark:text-white/70">
            {{ target.label }}
            <span v-if="rows[target.id].status === 'ready'" class="ml-1 font-normal">
              {{ t('rowReady', { count: doneCount(target.id) }) }}
            </span>
          </div>

          <div
            v-for="evaluation of rows[target.id].evaluations"
            :key="evaluation.puuid"
            class="rounded border border-black/10 bg-black/5 px-3 py-2 text-xs leading-relaxed dark:border-white/10 dark:bg-white/5"
          >
            <span class="font-bold">{{
              maskedName(evaluation.displayName || evaluation.name)
            }}</span>
            <span v-if="evaluation.status === 'done'" class="ml-2">{{ evaluation.reply }}</span>
            <span v-else class="ml-2 text-black/50 dark:text-white/50">
              {{ playerStatusText(evaluation) }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 分析提示词（只读展示） -->
    <NCollapse class="mt-3">
      <NCollapseItem :title="t('promptTitle')">
        <div
          class="max-h-60 overflow-auto rounded bg-black/5 p-2 text-xs leading-relaxed whitespace-pre-wrap dark:bg-white/5"
        >
          {{ AI_EVALUATION_SYSTEM_PROMPT }}
        </div>
      </NCollapseItem>
    </NCollapse>

    <!-- 手动查询 -->
    <SettingsRow class="mt-3" :label-width="180" align="center" no-x-padding>
      <template #label>
        {{ t('manual.label') }}
      </template>

      <div class="flex w-full items-center gap-2">
        <NInput
          v-model:value="manual.input"
          size="small"
          :placeholder="t('manual.placeholder')"
          :disabled="manualRunning"
          @keydown.enter="runManualEvaluation"
        />
        <NPopover :disabled="!manualQueryDisabledReason" trigger="hover">
          <template #trigger>
            <NButton
              size="small"
              secondary
              :loading="manualRunning"
              :disabled="!!manualQueryDisabledReason"
              @click="runManualEvaluation"
            >
              {{ t('manual.query') }}
            </NButton>
          </template>
          {{ manualQueryDisabledReason }}
        </NPopover>
      </div>
    </SettingsRow>

    <div
      v-if="manual.entry"
      class="mt-2 rounded border border-black/10 bg-black/5 px-3 py-2 text-xs leading-relaxed dark:border-white/10 dark:bg-white/5"
    >
      <span class="font-bold">{{ maskedName(manual.entry.displayName || manual.entry.name) }}</span>
      <div v-if="manual.entry.status === 'done'" class="mt-1">{{ manual.entry.reply }}</div>
      <div v-else class="mt-1 text-black/50 dark:text-white/50">
        {{ playerStatusText(manual.entry) }}
      </div>

      <div v-if="manual.entry.status === 'done'" class="mt-2 flex items-center gap-2">
        <NButton size="tiny" secondary :focusable="false" @click="copyManualReply">
          {{ t('copy') }}
        </NButton>
        <NRadioGroup v-model:value="manual.sendTarget" size="small">
          <NRadioButton v-for="target of targets" :key="target.id" :value="target.id">
            {{ target.label }}
          </NRadioButton>
        </NRadioGroup>
        <NButton
          size="tiny"
          type="primary"
          secondary
          :loading="manualSending"
          @click="handleSendManual"
        >
          {{ t('sendToChat') }}
        </NButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import LcuImage from '@renderer-shared/components/LcuImage.vue'
import SettingsRow from '@renderer-shared/components/SettingsRow.vue'
import { profileIconUri } from '@renderer-shared/shards/league-client/game-data-assets'
import { InGameSendRenderer } from '@renderer-shared/shards/in-game-send'
import { useInGameSendStore } from '@renderer-shared/shards/in-game-send/store'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { useStreamerModeMaskedText } from '@renderer-shared/composables/useStreamerModeMaskedText'
import { getInGameSendAiEvaluationShortcutTargetId } from '@shared/shards/in-game-send'
import ShortcutSelector from '@main-window/components/ShortcutSelector.vue'
import NameDisplayStrategySelector from '../widgets/NameDisplayStrategySelector.vue'
import { DocumentText24Regular as DryRunIcon, Send24Filled as SendIcon } from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NDivider,
  NIcon,
  NInput,
  NPopover,
  NRadioButton,
  NRadioGroup,
  useMessage
} from 'naive-ui'
import { computed, ref } from 'vue'

import { AI_EVALUATION_SYSTEM_PROMPT } from '../ai-evaluation/prompt'
import {
  type AiEvaluationPlayerEntry,
  type AiEvaluationTargetId,
  useAiEvaluation
} from '../ai-evaluation/use-ai-evaluation'
import { usePresetTargets } from '../widgets/usePresetTargets'

const { t } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation' })
const { t: tSelection } = useTranslation('renderer', {
  keyPrefix: 'toolkit.inGameSend.presets.selection'
})
const { t: tTargets } = useTranslation('renderer', {
  keyPrefix: 'toolkit.inGameSend.presets.targets'
})

const message = useMessage()
const as = useAppCommonStore()
const { masked } = useStreamerModeMaskedText()

const {
  rows,
  manual,
  manualRunning,
  allGamePlayers,
  selectedGamePlayerCount,
  isPlayerSelected,
  setPlayerSelected,
  setAllPlayersSelected,
  commonDisabledReason,
  getTargetDisabledReason,
  getTargetSendDisabledReason,
  getTargetPlayers,
  runTargetEvaluation,
  sendTargetReplies,
  runManualEvaluation,
  sendManualReply
} = useAiEvaluation()

const targets = usePresetTargets()
const igsStore = useInGameSendStore()
const igs = useInstance(InGameSendRenderer)
const manualSending = ref(false)

function getShortcutTargetId(target: AiEvaluationTargetId) {
  return getInGameSendAiEvaluationShortcutTargetId(target)
}

function setShortcut(target: AiEvaluationTargetId, shortcutId: string | null) {
  void igs.setAiEvaluationTargetShortcut(target, shortcutId)
}

function targetDryRunDisabledReason(target: AiEvaluationTargetId) {
  return getTargetDisabledReason(target)
}

function targetDescription(target: { id: AiEvaluationTargetId; description: string }) {
  const count = getTargetPlayers(target.id).length
  return `${target.description} · ${t('teamsCount', { count })}`
}

const playerGroups = computed(() => {
  const groups: {
    label: string
    members: {
      puuid: string
      name: string
      gameName: string
      tagLine: string
      championId: number | null
      profileIconId: number | null
    }[]
    selectedCount: number
  }[] = []

  for (const isOwnTeam of [true, false]) {
    const members = allGamePlayers.value.filter((p) => p.isOwnTeam === isOwnTeam)
    if (!members.length) continue

    groups.push({
      label: isOwnTeam ? tTargets('friendly.label') : tTargets('enemy.label'),
      members,
      selectedCount: members.filter((p) => isPlayerSelected(p.puuid)).length
    })
  }

  return groups
})

function setGroupSelected(group: { members: { puuid: string }[] }, checked: boolean) {
  for (const member of group.members) {
    setPlayerSelected(member.puuid, checked)
  }
}

function doneCount(target: AiEvaluationTargetId) {
  return rows[target].evaluations.filter((e) => e.status === 'done').length
}

function playerStatusText(evaluation: AiEvaluationPlayerEntry) {
  switch (evaluation.status) {
    case 'pending':
      return t('playerStatus.pending')
    case 'fetching':
      return t('playerStatus.fetching')
    case 'analyzing':
      return t('playerStatus.analyzing')
    case 'no-data':
      return t('playerStatus.noData')
    case 'error':
      return t('playerStatus.error', { message: evaluation.errorMessage })
    default:
      return ''
  }
}

/** 界面上的玩家名遵守主播模式脱敏 */
function maskedName(name: string) {
  return masked(name)
}

function manualQueryDisabledReason() {
  if (manualRunning.value) {
    return t('reasons.running')
  }

  return commonDisabledReason()
}

async function copyManualReply() {
  const reply = manual.entry?.reply
  if (!reply) return

  await navigator.clipboard.writeText(reply)
  message.success(t('copied'))
}

async function handleSendManual() {
  if (manualSending.value) return

  manualSending.value = true
  try {
    await sendManualReply()
  } finally {
    manualSending.value = false
  }
}

async function handleSendTarget(target: AiEvaluationTargetId) {
  await sendTargetReplies(target)
}
</script>
