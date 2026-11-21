<template>
  <SettingsSection :setting-id="settingId" :title="tr('title')" :footer="tr('description')">
    <SettingsRow :setting-id="`${settingId}.enabled`" :label="tr('enabled')" :label-width="260">
      <template #label>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{{ tr('enabled') }}</span>
          <NTag
            v-if="enabled"
            size="small"
            round
            :bordered="false"
            :type="statusType"
            role="status"
          >
            <template #icon>
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            </template>
            {{ tr(`status.${snapshot.status}`) }}
          </NTag>
        </div>
      </template>
      <template v-if="enabled && snapshot.lastScanDurationMs !== null" #labelDescription>
        <span class="text-xs tabular-nums">
          {{ tr('duration', { ms: snapshot.lastScanDurationMs }) }}
        </span>
        <div class="mt-1 text-xs tabular-nums">
          {{
            tr('attempts', {
              follow: snapshot.followAttempts,
              accept: snapshot.acceptAttempts,
              max: AUTO_SURRENDER_MAX_ATTEMPTS
            })
          }}
        </div>
      </template>
      <NSwitch
        size="small"
        :value="enabled"
        :disabled="!appCommon.nativeSupport.nativeInput.available && !enabled"
        @update:value="setEnabled"
      />
    </SettingsRow>
    <div v-if="unavailableReason || snapshot.error" class="flex flex-col gap-3 px-4 py-3">
      <NAlert v-if="unavailableReason" type="warning" :show-icon="false">
        {{ unavailableReason }}
      </NAlert>
      <NAlert v-if="snapshot.error" type="error" :show-icon="false">
        {{ tr(`errors.${snapshot.error}`) }}
      </NAlert>
    </div>
    <SurrenderRegionSettings mode="follow" />
    <SurrenderRegionSettings mode="accept" />
    <NCollapse v-if="snapshot.lastText" class="px-4 pb-4">
      <NCollapseItem :title="tr('lastText')">
        <div class="text-xs break-words">{{ snapshot.lastText }}</div>
      </NCollapseItem>
    </NCollapse>
  </SettingsSection>
</template>

<script setup lang="ts">
import SettingsRow from '@main-window/settings-navigation/NavigableSettingsRow.vue'
import SettingsSection from '@main-window/settings-navigation/NavigableSettingsSection.vue'
import { useInstance } from '@renderer-shared/shards'
import { resolveNativeInputStatus } from '@renderer-shared/shards/app-common/native-input-status'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { AutoMiscRenderer } from '@renderer-shared/shards/auto-misc'
import { useAutoMiscStore } from '@renderer-shared/shards/auto-misc/store'
import { AUTO_SURRENDER_MAX_ATTEMPTS } from '@shared/shards/auto-misc/auto-surrender'
import { useTranslation } from 'i18next-vue'
import { NAlert, NCollapse, NCollapseItem, NSwitch, NTag, useMessage } from 'naive-ui'
import { computed } from 'vue'
import SurrenderRegionSettings from './SurrenderRegionSettings.vue'

const { t } = useTranslation()
const settingId = 'automation.misc.auto-surrender'
const tr = (key: string, options?: Record<string, unknown>) =>
  t(`automation.misc.autoSurrender.${key}`, options)
const store = useAutoMiscStore()
const enabled = computed(() => store.settings.autoSurrenderEnabled)
const snapshot = computed(() => store.autoSurrender)
const autoMisc = useInstance(AutoMiscRenderer)
const appCommon = useAppCommonStore()
const message = useMessage()
const statusType = computed(
  () =>
    (
      ({
        idle: 'default',
        starting: 'info',
        watching: 'success',
        paused: 'warning',
        triggered: 'success',
        retrying: 'info',
        exhausted: 'warning',
        unavailable: 'warning',
        error: 'error'
      }) as const
    )[snapshot.value.status]
)
const unavailableReason = computed(() => {
  const status = resolveNativeInputStatus(appCommon.nativeSupport.nativeInput, appCommon.isElevated)
  if (status === 'available') return null
  const keys = {
    'unsupported-platform': 'unsupported',
    'requires-elevation': 'needAdmin',
    'initialization-failed': 'initializationFailed'
  } as const
  return t(`toolkit.inGameSend.presets.nativeInput.${keys[status]}`)
})
async function setEnabled(value: boolean) {
  try {
    await autoMisc.setAutoSurrenderEnabled(value)
  } catch {
    message.error(tr('saveFailed'))
  }
}
</script>
