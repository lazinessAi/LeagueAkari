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

    <!-- 与预设 tab 同构的目标行 / 发送 / 试运行 -->
    <div class="pt-2">
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
              :shortcut-id="shortcuts[target.id]"
              :target-id="shortcutTargetIds[target.id]"
              @update:shortcut-id="(shortcutId) => setShortcut(target.id, shortcutId)"
            />
          </div>
          <NDivider vertical />
          <NPopover :disabled="!sendDisabledReason()" trigger="hover">
            <template #trigger>
              <NButton
                size="small"
                :disabled="sendDisabledReason() !== ''"
                @click="handleSendTarget(target.id)"
              >
                <template #icon>
                  <NIcon><SendIcon /></NIcon>
                </template>
                {{ sendButtonText }}
              </NButton>
            </template>
            {{ sendDisabledReason() }}
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

      <!-- Keep the final row divider when content follows this group. -->
      <span hidden aria-hidden="true"></span>
    </div>

    <!-- 生成结果预览 -->
    <PreviewPanel :preset="scope" constrained />

    <!-- 名字展示 -->
    <NameDisplayStrategySelector
      :value="igsStore.settings.aiEvaluationNameDisplayStrategy"
      @update:value="(strategy) => igs.setAiEvaluationNameDisplayStrategy(strategy)"
    />

    <!-- 发送的目标：按玩家勾选 -->
    <div v-if="allGamePlayers.length" class="flex flex-col gap-2">
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
              <div
                class="size-2.5 shrink-0 rounded-full border border-white/20 bg-current opacity-40"
              />
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
        <NPopover :disabled="!manualQueryDisabledReason()" trigger="hover">
          <template #trigger>
            <NButton
              size="small"
              secondary
              :loading="manualRunning"
              :disabled="!!manualQueryDisabledReason()"
              @click="runManualEvaluation"
            >
              {{ t('manual.query') }}
            </NButton>
          </template>
          {{ manualQueryDisabledReason() }}
        </NPopover>
      </div>
    </SettingsRow>

    <div v-if="manual.errorMessage" class="mt-1 text-xs text-red-600 dark:text-red-400">
      {{ manual.errorMessage }}
    </div>

    <div
      v-if="manual.entry"
      class="mt-2 rounded border border-black/10 bg-black/5 px-3 py-2 text-xs leading-relaxed dark:border-white/10 dark:bg-white/5"
    >
      <span class="font-bold">{{ maskedName(manual.entry.displayName || manual.entry.name) }}</span>
      <div v-if="manual.entry.status === 'done'" class="mt-1">{{ manual.entry.reply }}</div>
      <div v-else class="mt-1 text-black/50 dark:text-white/50">
        {{ manualPlayerStatusText() }}
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
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { useInGameSendStore } from '@renderer-shared/shards/in-game-send/store'
import { useStreamerModeMaskedText } from '@renderer-shared/composables/useStreamerModeMaskedText'
import { useInstance } from '@renderer-shared/shards'
import { InGameSendRenderer } from '@renderer-shared/shards/in-game-send'
import {
  DocumentText24Regular as DryRunIcon,
  Send24Filled as SendIcon,
  Warning24Regular as WarningIcon
} from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NDivider,
  NIcon,
  NInput,
  NPopover,
  NRadioButton,
  NRadioGroup,
  useMessage
} from 'naive-ui'
import { computed, ref } from 'vue'

import NameDisplayStrategySelector from '../widgets/NameDisplayStrategySelector.vue'
import PreviewPanel from '../widgets/PreviewPanel.vue'
import ShortcutSelector from '@main-window/components/ShortcutSelector.vue'
import { usePresetTargets } from '../widgets/usePresetTargets'
import { type AiEvaluationTargetId, useAiEvaluation } from '../ai-evaluation/use-ai-evaluation'

const { t } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation' })
const { t: tSelection } = useTranslation('renderer', {
  keyPrefix: 'toolkit.inGameSend.presets.selection'
})
const { t: tTeams } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets.teams' })

const message = useMessage()
const as = useAppCommonStore()
const { masked } = useStreamerModeMaskedText()

const igs = useInstance(InGameSendRenderer)
const igsStore = useInGameSendStore()
const targets = usePresetTargets()
const manualSending = ref(false)

// PresetScopeContext 适配器（快捷键 / 发送 / 试运行 / 预览面板均复用预设 tab 的组件）
const aiEvaluation = useAiEvaluation()
const scope = aiEvaluation

const {
  shortcutTargetIds,
  shortcuts,
  setShortcut,
  dryRun,
  gamePhase,
  running,
  previewedLines,
  allGamePlayers,
  selectedGamePlayerCount,
  isPlayerSelected,
  setPlayerSelected,
  setAllPlayersSelected,
  manual,
  manualRunning,
  runManualEvaluation,
  sendManualReply,
  commonDisabledReason
} = aiEvaluation

const playerGroups = computed(() => {
  const groups: {
    isOwnTeam: boolean
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
      isOwnTeam,
      label: tTeams(isOwnTeam ? 'friendly' : 'enemy'),
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

const sendButtonText = computed(() => {
  if (gamePhase.value === 'in-game') {
    return t('sendToGame')
  }

  return t('sendToChat')
})

function sendDisabledReason() {
  if (running.value) {
    return t('reasons.running')
  }

  if (!previewedLines.value) {
    return t('reasons.notReady')
  }

  return ''
}

function dryRunDisabledReason() {
  return commonDisabledReason()
}

function targetDescription(target: { id: AiEvaluationTargetId; description: string }) {
  const count = aiEvaluation.getTargetPlayers(target.id).length
  return `${target.description} · ${t('teamsCount', { count })}`
}

function manualQueryDisabledReason() {
  if (manualRunning.value) {
    return t('reasons.running')
  }

  return commonDisabledReason()
}

function manualPlayerStatusText() {
  const entry = manual.entry

  if (!entry) {
    return ''
  }

  switch (entry.status) {
    case 'fetching':
      return t('playerStatus.fetching')
    case 'analyzing':
      return t('playerStatus.analyzing')
    case 'no-data':
      return t('playerStatus.noData')
    case 'error':
      return t('playerStatus.error', { message: entry.errorMessage })
    default:
      return ''
  }
}

/** 界面上的玩家名遵守主播模式脱敏 */
function maskedName(name: string) {
  return masked(name)
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
    const sent = await sendManualReply()

    if (!sent) {
      message.error(t('sendFailed'))
    }
  } finally {
    manualSending.value = false
  }
}

async function handleSendTarget(target: AiEvaluationTargetId) {
  const sent = await aiEvaluation.send(target)

  if (!sent) {
    message.error(t('sendFailed'))
  }
}
</script>
