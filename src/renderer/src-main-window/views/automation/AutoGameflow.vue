<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full" ref="el">
      <div class="mx-auto flex max-w-200 flex-col gap-6 p-6">
        <SettingsSection
          setting-id="automation.gameflow.ready-check"
          :title="t('automation.gameflow.sections.readyCheck')"
          :footer="t('automation.gameflow.autoAcceptEnabled.footer')"
        >
          <SettingsRow
            setting-id="automation.gameflow.ready-check.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoAcceptEnabled.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoAcceptEnabled"
              @update:value="(val) => shard.setAutoAcceptEnabled(val)"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.ready-check.delay"
            :label="t('automation.gameflow.autoAcceptDelaySeconds.label')"
            :label-description="t('automation.gameflow.autoAcceptDelaySeconds.description')"
            :label-width="260"
          >
            <NInputNumber
              class="w-25!"
              :value="store.settings.autoAcceptDelaySeconds"
              @update:value="(value) => shard.setAutoAcceptDelaySeconds(value || 0)"
              :min="0"
              :max="10"
              size="small"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          setting-id="automation.gameflow.auto-honor"
          :title="t('automation.gameflow.sections.autoHonor')"
        >
          <SettingsRow
            setting-id="automation.gameflow.auto-honor.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoHonorEnabled.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoHonorEnabled"
              @update:value="(val) => shard.setAutoHonorEnabled(val)"
              size="small"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          setting-id="automation.gameflow.play-again"
          :title="t('automation.gameflow.sections.playAgain')"
        >
          <SettingsRow
            setting-id="automation.gameflow.play-again.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-width="260"
          >
            <template #labelDescription>
              <TranslationComponent
                :translation="t('automation.gameflow.playAgainEnabled.description.full')"
              >
                <template #autoHonor>
                  <NCheckbox
                    class="mx-0.5 text-[13px]"
                    size="small"
                    :checked="store.settings.autoHonorEnabled"
                    @update:checked="(val) => shard.setAutoHonorEnabled(val)"
                  >
                    {{ t('automation.gameflow.playAgainEnabled.description.part2') }}
                  </NCheckbox>
                </template>
              </TranslationComponent>
            </template>
            <NSwitch
              :value="store.settings.playAgainEnabled"
              @update:value="(val) => shard.setPlayAgainEnabled(val)"
              size="small"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          setting-id="automation.gameflow.auto-matchmaking"
          :title="t('automation.gameflow.sections.autoMatchmaking')"
        >
          <SettingsRow
            setting-id="automation.gameflow.auto-matchmaking.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoMatchmakingEnabled.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoMatchmakingEnabled"
              @update:value="(val) => shard.setAutoMatchmakingEnabled(val)"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.auto-matchmaking.minimum-members"
            :label="t('automation.gameflow.autoMatchmakingMinimumMembers.label')"
            :label-description="
              t('automation.gameflow.autoMatchmakingMinimumMembers.description', {
                members: store.settings.autoMatchmakingMinimumMembers
              })
            "
            :label-width="260"
          >
            <NInputNumber
              class="w-25!"
              :value="store.settings.autoMatchmakingMinimumMembers"
              @update:value="(val) => shard.setAutoMatchmakingMinimumMembers(val || 1)"
              :min="1"
              :max="99"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.auto-matchmaking.delay"
            :label="t('automation.gameflow.autoMatchmakingDelaySeconds.label')"
            :label-description="t('automation.gameflow.autoMatchmakingDelaySeconds.description')"
            :label-width="260"
          >
            <NInputNumber
              class="w-25!"
              :value="store.settings.autoMatchmakingDelaySeconds"
              @update:value="(value) => shard.setAutoMatchmakingDelaySeconds(value || 0)"
              placeholder="秒"
              :min="0"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.auto-matchmaking.wait-for-invitees"
            :label="t('automation.gameflow.autoMatchmakingWaitForInvitees.label')"
            :label-description="t('automation.gameflow.autoMatchmakingWaitForInvitees.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoMatchmakingWaitForInvitees"
              @update:value="(val) => shard.setAutoMatchmakingWaitForInvitees(val)"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.auto-matchmaking.rematch-strategy"
            :label="t('automation.gameflow.autoMatchmakingRematchStrategy.label')"
            :label-description="t('automation.gameflow.autoMatchmakingRematchStrategy.description')"
            :label-width="260"
          >
            <NRadioGroup
              class="max-w-full"
              :value="store.settings.autoMatchmakingRematchStrategy"
              @update:value="(s) => shard.setAutoMatchmakingRematchStrategy(s)"
              size="small"
            >
              <NFlex :size="8" class="justify-end">
                <NRadio value="never">{{
                  t('automation.gameflow.autoMatchmakingRematchStrategy.options.never')
                }}</NRadio>
                <NRadio value="fixed-duration">{{
                  t('automation.gameflow.autoMatchmakingRematchStrategy.options.fixed-duration')
                }}</NRadio>
                <NRadio value="estimated-duration">{{
                  t('automation.gameflow.autoMatchmakingRematchStrategy.options.estimated-duration')
                }}</NRadio>
              </NFlex>
            </NRadioGroup>
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.auto-matchmaking.rematch-fixed-duration"
            :label="t('automation.gameflow.autoMatchmakingRematchFixedDuration.label')"
            :label-description="
              store.settings.autoMatchmakingRematchStrategy !== 'fixed-duration'
                ? t(
                    'automation.gameflow.autoMatchmakingRematchFixedDuration.description.no-fixed-duration'
                  )
                : t(
                    'automation.gameflow.autoMatchmakingRematchFixedDuration.description.fixed-duration'
                  )
            "
            :disabled="store.settings.autoMatchmakingRematchStrategy !== 'fixed-duration'"
            :label-width="260"
          >
            <NInputNumber
              :disabled="store.settings.autoMatchmakingRematchStrategy !== 'fixed-duration'"
              class="w-25!"
              :value="store.settings.autoMatchmakingRematchFixedDuration"
              @update:value="(value) => shard.setAutoMatchmakingRematchFixedDuration(value || 2)"
              :min="1"
              size="small"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          setting-id="automation.gameflow.auto-reconnect"
          :title="t('automation.gameflow.sections.autoReconnect')"
        >
          <SettingsRow
            setting-id="automation.gameflow.auto-reconnect.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoReconnectEnabled.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoReconnectEnabled"
              @update:value="(val) => shard.setAutoReconnectEnabled(val)"
              size="small"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          setting-id="automation.gameflow.leader"
          :title="t('automation.gameflow.sections.leader')"
        >
          <SettingsRow
            setting-id="automation.gameflow.leader.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoSkipLeaderEnabled.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoSkipLeaderEnabled"
              @update:value="(val) => shard.setAutoSkipLeaderEnabled(val)"
              size="small"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          setting-id="automation.gameflow.invitations"
          :title="t('automation.gameflow.sections.invitations')"
        >
          <SettingsRow
            setting-id="automation.gameflow.invitations.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoHandleInvitationsEnabled.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.autoHandleInvitationsEnabled"
              @update:value="(val) => shard.setAutoHandleInvitationsEnabled(val)"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.invitations.reject-when-away"
            :label="t('automation.gameflow.rejectInvitationWhenAway.label')"
            :label-description="t('automation.gameflow.rejectInvitationWhenAway.description')"
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.rejectInvitationWhenAway"
              @update:value="(val) => shard.setRejectInvitationWhenAway(val)"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.invitations.strategies"
            :label="t('automation.gameflow.invitationHandlingStrategies.label')"
            :label-description="t('automation.gameflow.invitationHandlingStrategies.description')"
            :label-width="260"
            align="start"
          >
            <NFlex vertical align="flex-start" class="max-w-full">
              <table class="max-w-full table-auto border-separate border-spacing-0">
                <tbody>
                  <tr v-for="s of invitationStrategiesArray" :key="s.queueType">
                    <td
                      class="max-w-40 truncate py-1 pr-4 text-[13px] font-bold text-black/80 dark:text-white/90"
                    >
                      {{ queueTypes[s.queueType]?.label || s.queueType }}
                    </td>
                    <td class="py-1">
                      <NRadioGroup
                        :value="s.strategy"
                        @update:value="(val) => handleChangeInvitationStrategy(s.queueType, val)"
                        size="small"
                      >
                        <NFlex :size="8">
                          <NRadio value="accept">{{
                            t('automation.gameflow.invitationHandlingStrategies.options.accept')
                          }}</NRadio>
                          <NRadio value="decline">{{
                            t('automation.gameflow.invitationHandlingStrategies.options.decline')
                          }}</NRadio>
                          <NRadio value="ignore">{{
                            t('automation.gameflow.invitationHandlingStrategies.options.ignore')
                          }}</NRadio>
                        </NFlex>
                      </NRadioGroup>
                    </td>
                  </tr>
                </tbody>
              </table>
              <NPopselect
                :options="queueTypeOptions"
                multiple
                trigger="click"
                :value="invitationStrategiesPopselectArray"
                @update:value="handleChangeInvitationStrategies"
              >
                <NButton size="tiny" type="primary">{{
                  t('automation.gameflow.invitationHandlingStrategies.button')
                }}</NButton>
              </NPopselect>
            </NFlex>
          </SettingsRow>
          <SettingsRow
            setting-id="automation.gameflow.invitations.only-from-friends"
            :label="t('automation.gameflow.onlyAcceptInvitationFromFriends.label')"
            :label-description="
              t('automation.gameflow.onlyAcceptInvitationFromFriends.description')
            "
            :label-width="260"
          >
            <NSwitch
              :value="store.settings.onlyAcceptInvitationFromFriends"
              @update:value="(val) => shard.setOnlyAcceptInvitationFromFriends(val)"
              size="small"
            />
          </SettingsRow>
          <SettingsRow
            v-if="store.settings.onlyAcceptInvitationFromFriends"
            setting-id="automation.gameflow.invitations.friend-whitelist"
            :label="t('automation.gameflow.acceptInvitationFriendWhitelist.label')"
            :label-description="
              t('automation.gameflow.acceptInvitationFriendWhitelist.description')
            "
            :label-width="260"
            align="start"
          >
            <div class="w-full max-w-100">
              <div
                v-if="!lcs.isConnected"
                class="flex h-20 items-center justify-center rounded-md bg-black/5 p-2 text-center text-[13px] text-black/50 dark:bg-white/5 dark:text-white/50"
              >
                <span>{{
                  t('automation.gameflow.acceptInvitationFriendWhitelist.unavailable')
                }}</span>
              </div>
              <div v-else>
                <NInput
                  :value="friendSearchInput"
                  clearable
                  size="small"
                  :placeholder="
                    t('automation.gameflow.acceptInvitationFriendWhitelist.searchPlaceholder')
                  "
                  class="mb-2"
                  @update:value="handleFriendSearchUpdate"
                  @compositionstart="handleFriendSearchCompositionStart"
                  @compositionend="handleFriendSearchCompositionEnd"
                >
                  <template #prefix>
                    <NIcon><SearchIcon /></NIcon>
                  </template>
                </NInput>

                <NScrollbar class="max-h-80">
                  <div class="space-y-1.5 pr-1">
                    <div
                      v-for="friend in filteredSortedFriends"
                      :key="friend.puuid"
                      class="flex items-center gap-3 rounded-md border border-black/10 py-1.5 pr-4 pl-2.5 dark:border-white/10"
                    >
                      <div class="relative">
                        <LcuImage
                          class="size-8 rounded-full"
                          :src="profileIconUri(friend.icon || 29)"
                        />
                        <div
                          class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-white dark:border-neutral-900"
                          :class="{
                            'bg-green-500': friend.availability === 'chat',
                            'bg-cyan-500': friend.availability === 'dnd',
                            'bg-red-500': friend.availability === 'away',
                            'bg-gray-400': friend.availability === 'offline'
                          }"
                        ></div>
                      </div>
                      <div class="flex min-w-0 flex-1 items-end gap-1">
                        <div class="truncate text-[13px] font-medium">{{ friend.gameName }}</div>
                        <div class="truncate text-xs text-black/60 dark:text-white/60">
                          #{{ friend.gameTag }}
                        </div>
                      </div>
                      <NCheckbox
                        :checked="isWhitelisted(friend.summonerId)"
                        @update:checked="() => toggleWhitelist(friend)"
                      />
                    </div>
                    <div
                      v-if="filteredSortedFriends.length === 0"
                      class="py-6 text-center text-[13px] text-black/50 dark:text-white/50"
                    >
                      <span>{{
                        t('automation.gameflow.acceptInvitationFriendWhitelist.noFriends')
                      }}</span>
                    </div>
                  </div>
                </NScrollbar>
              </div>
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection setting-id="automation.gameflow.aram-team-side">
          <template #header>
            <TooltipWithIcon>
              <span class="text-sm leading-5 font-bold text-black/80 dark:text-white/90">
                {{ t('automation.gameflow.sections.aramTeamSide') }}
              </span>
              <template #tooltip>
                <div class="max-w-90 text-xs leading-relaxed font-normal">
                  <img
                    :src="aramTeamSideMessageImage"
                    :alt="t('automation.gameflow.autoSendARAMTeamSideEnabled.tooltipImageAlt')"
                    class="mb-2 aspect-1680/935 w-90 max-w-full rounded border border-black/10 object-cover dark:border-white/10"
                  />
                  <div>{{ t('automation.gameflow.autoSendARAMTeamSideEnabled.tooltipBody') }}</div>
                </div>
              </template>
            </TooltipWithIcon>
          </template>
          <SettingsRow
            setting-id="automation.gameflow.aram-team-side.enabled"
            :label="t('automation.gameflow.common.enabled')"
            :label-description="t('automation.gameflow.autoSendARAMTeamSideEnabled.description')"
            :label-width="260"
          >
            <div class="flex flex-col items-end gap-2">
              <NSwitch
                :value="store.settings.autoSendARAMTeamSideEnabled"
                @update:value="(val) => shard.setAutoSendARAMTeamSideEnabled(val)"
                size="small"
              />
              <NCheckbox
                size="small"
                class="text-[13px]"
                :disabled="!store.settings.autoSendARAMTeamSideEnabled"
                :checked="store.settings.autoSendARAMTeamSideVisibleToTeam"
                @update:checked="(val) => shard.setAutoSendARAMTeamSideVisibleToTeam(val)"
              >
                {{ t('automation.gameflow.autoSendARAMTeamSideVisibleToTeam.checkboxLabel') }}
              </NCheckbox>
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import LcuImage from '@renderer-shared/components/LcuImage.vue'
import SettingsRow from '@main-window/settings-navigation/NavigableSettingsRow.vue'
import SettingsSection from '@main-window/settings-navigation/NavigableSettingsSection.vue'
import TooltipWithIcon from '@renderer-shared/components/TooltipWithIcon.vue'
import aramTeamSideMessageImage from '@renderer-shared/assets/automation/aram-team-side-message.webp'
import { useCompositionAwareInput } from '@renderer-shared/composables/useCompositionAwareInput'
import { useInstance } from '@renderer-shared/shards'
import { AutoGameflowRenderer } from '@renderer-shared/shards/auto-gameflow'
import { useAutoGameflowStore } from '@renderer-shared/shards/auto-gameflow/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { profileIconUri } from '@renderer-shared/shards/league-client/game-data-assets'
import type { Friend } from '@shared/types/league-client/chat'
import { Search as SearchIcon } from '@vicons/carbon'
import { TranslationComponent, useTranslation } from 'i18next-vue'
import {
  NButton,
  NCheckbox,
  NFlex,
  NIcon,
  NInput,
  NInputNumber,
  NPopselect,
  NRadio,
  NRadioGroup,
  NScrollbar,
  NSwitch
} from 'naive-ui'
import { computed } from 'vue'

import { useSelfHostedLcuDataStore } from '@main-window/shards/self-hosted-lcu-data/store'

const store = useAutoGameflowStore()
const shard = useInstance(AutoGameflowRenderer)

const lcs = useLeagueClientStore()
const shs = useSelfHostedLcuDataStore()

const FRIEND_PRIORITY: Record<string, number> = {
  chat: 0,
  dnd: 1,
  away: 1,
  offline: 2
}

const {
  inputValue: friendSearchInput,
  committedValue: friendSearchQuery,
  handleUpdateValue: handleFriendSearchUpdate,
  handleCompositionStart: handleFriendSearchCompositionStart,
  handleCompositionEnd: handleFriendSearchCompositionEnd
} = useCompositionAwareInput()

const sortedFriends = computed(() => {
  return shs.friends.toSorted((a, b) => {
    const pa = FRIEND_PRIORITY[a.availability] ?? 3
    const pb = FRIEND_PRIORITY[b.availability] ?? 3

    if (pa !== pb) {
      return pa - pb
    }

    return a.gameName.localeCompare(b.gameName)
  })
})

const filteredSortedFriends = computed(() => {
  const keyword = friendSearchQuery.value.trim().toLowerCase()

  if (!keyword) {
    return sortedFriends.value
  }

  return sortedFriends.value.filter((friend) => {
    return (
      (friend.gameName?.toLowerCase() || '').includes(keyword) ||
      (friend.gameTag?.toLowerCase() || '').includes(keyword)
    )
  })
})

const isWhitelisted = (summonerId: number) => {
  return store.settings.acceptInvitationFriendWhitelist.some(
    (entry) => entry.summonerId === summonerId
  )
}

const toggleWhitelist = (friend: Friend) => {
  const current = store.settings.acceptInvitationFriendWhitelist

  if (isWhitelisted(friend.summonerId)) {
    shard.setAcceptInvitationFriendWhitelist(
      current.filter((entry) => entry.summonerId !== friend.summonerId)
    )
  } else {
    shard.setAcceptInvitationFriendWhitelist([
      ...current,
      { summonerId: friend.summonerId, name: `${friend.gameName} #${friend.gameTag}` }
    ])
  }
}

const invitationStrategiesPopselectArray = computed(() => {
  return Object.keys(store.settings.invitationHandlingStrategies)
})

const handleChangeInvitationStrategies = (value: string[]) => {
  const newStrategies: Record<string, string> = {}

  for (const strategy of value) {
    if (store.settings.invitationHandlingStrategies[strategy]) {
      newStrategies[strategy] = store.settings.invitationHandlingStrategies[strategy]
    } else {
      newStrategies[strategy] = 'ignore'
    }
  }

  shard.setInvitationHandlingStrategies(newStrategies)
}

const { t } = useTranslation()

const queueTypes = computed(() => {
  return {
    '<DEFAULT>': {
      label: t('automation.gameflow.invitationHandlingStrategies.queueTypes.default'),
      order: 0
    },
    RANKED_SOLO_5x5: {
      label: t('queueTypes.RANKED_SOLO_5x5', { ns: 'common' }),
      order: 100
    },
    RANKED_FLEX_SR: {
      label: t('queueTypes.RANKED_FLEX_SR', { ns: 'common' }),
      order: 110
    },
    NORMAL: {
      label: t('queueTypes.NORMAL', { ns: 'common' }),
      order: 200
    },
    ARAM_UNRANKED_5x5: {
      label: t('queueTypes.ARAM_UNRANKED_5x5', { ns: 'common' }),
      order: 300
    },
    KIWI: {
      label: t('queueTypes.KIWI', { ns: 'common' }),
      order: 310
    },
    CHERRY: {
      label: t('queueTypes.CHERRY', { ns: 'common' }),
      order: 400
    },
    URF: {
      label: t('queueTypes.URF', { ns: 'common' }),
      order: 500
    },
    NORMAL_TFT: {
      label: t('queueTypes.NORMAL_TFT', { ns: 'common' }),
      order: 600
    },
    RANKED_TFT: {
      label: t('queueTypes.RANKED_TFT', { ns: 'common' }),
      order: 610
    },
    RANKED_TFT_TURBO: {
      label: t('queueTypes.RANKED_TFT_TURBO', { ns: 'common' }),
      order: 620
    },
    RANKED_TFT_DOUBLE_UP: {
      label: t('queueTypes.RANKED_TFT_DOUBLE_UP', { ns: 'common' }),
      order: 630
    }
  }
})

const invitationStrategiesArray = computed(() => {
  return Object.entries(store.settings.invitationHandlingStrategies)
    .map(([queueType, strategy]) => {
      return {
        queueType,
        strategy
      }
    })
    .toSorted((a, b) => {
      const aQueueTypeOrder = queueTypes[a.queueType] ? queueTypes[a.queueType].order : 0
      const bQueueTypeOrder = queueTypes[b.queueType] ? queueTypes[b.queueType].order : 0

      return aQueueTypeOrder - bQueueTypeOrder
    })
})

const queueTypeOptions = computed(() => {
  return Object.keys(queueTypes.value)
    .map((key) => {
      return {
        value: key,
        label: queueTypes.value[key].label
      }
    })
    .toSorted((a, b) => {
      return queueTypes.value[a.value].order - queueTypes.value[b.value].order
    })
})

const handleChangeInvitationStrategy = (queueType: string, strategy: string) => {
  const newObj = { ...store.settings.invitationHandlingStrategies }
  newObj[queueType] = strategy
  shard.setInvitationHandlingStrategies(newObj)
}
</script>
