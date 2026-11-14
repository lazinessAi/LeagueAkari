<template>
  <SettingsSection
    setting-id="automation.misc.auto-surrender"
    :title="t('automation.misc.autoSurrender.title')"
    :footer="t('automation.misc.autoSurrender.description')"
  >
    <SettingsRow
      setting-id="automation.misc.auto-surrender.enabled"
      :label="t('automation.misc.autoSurrender.enabled')"
      :label-width="260"
    >
      <NSwitch
        size="small"
        :value="store.settings.autoSurrenderEnabled"
        :disabled="
          !appCommon.nativeSupport.nativeInput.available && !store.settings.autoSurrenderEnabled
        "
        @update:value="setEnabled"
      />
    </SettingsRow>
    <SettingsRow
      setting-id="automation.misc.auto-surrender.always-check"
      :label="t('automation.misc.autoSurrender.alwaysCheck.label')"
      :label-description="t('automation.misc.autoSurrender.alwaysCheck.description')"
      :label-width="260"
    >
      <NSwitch
        size="small"
        :value="store.settings.autoSurrenderAlwaysCheck"
        @update:value="setAlwaysCheck"
      />
    </SettingsRow>
    <div class="flex flex-col gap-3 px-4 pb-4">
      <NAlert v-if="unavailableReason" type="warning" :show-icon="false">
        {{ unavailableReason }}
      </NAlert>
      <div class="flex items-center justify-between gap-3 text-xs">
        <span>{{ t(`automation.misc.autoSurrender.status.${store.autoSurrender.status}`) }}</span>
        <span v-if="store.autoSurrender.lastScanDurationMs !== null" class="opacity-60">
          {{
            t('automation.misc.autoSurrender.duration', {
              ms: store.autoSurrender.lastScanDurationMs
            })
          }}
        </span>
      </div>
      <NAlert v-if="store.autoSurrender.error" type="error" :show-icon="false">
        {{ t(`automation.misc.autoSurrender.errors.${store.autoSurrender.error}`) }}
      </NAlert>
    </div>
    <SettingsRow
      setting-id="automation.misc.auto-surrender.region"
      :label="t('automation.misc.autoSurrender.region.label')"
      :label-description="t('automation.misc.autoSurrender.region.description')"
      :label-width="260"
      align="start"
    >
      <div class="flex w-90 max-w-full flex-col gap-2">
        <div class="grid grid-cols-2 gap-x-3 gap-y-2">
          <div v-for="field in regionFields" :key="field" class="flex flex-col gap-1">
            <span class="text-xs">{{ t(`automation.misc.autoSurrender.region.${field}`) }}</span>
            <NInputNumber
              v-model:value="region[field]"
              size="small"
              :min="field === 'width' || field === 'height' ? 1 : 0"
              :max="field === 'x' || field === 'y' ? 99 : 100"
              :precision="0"
              :aria-label="t(`automation.misc.autoSurrender.region.${field}`)"
            >
              <template #suffix>%</template>
            </NInputNumber>
          </div>
        </div>
        <span v-if="!validRegion" class="text-xs text-red-500">
          {{ t('automation.misc.autoSurrender.region.invalid') }}
        </span>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="resetRegion">{{
            t('automation.misc.autoSurrender.region.reset')
          }}</NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!validRegion || !dirty"
            :loading="saving"
            @click="saveRegion"
          >
            {{ t('automation.misc.autoSurrender.region.save') }}
          </NButton>
        </div>
      </div>
    </SettingsRow>
    <NCollapse v-if="store.autoSurrender.lastText" class="px-4 pb-4">
      <NCollapseItem :title="t('automation.misc.autoSurrender.lastText')">
        <div class="text-xs break-words">{{ store.autoSurrender.lastText }}</div>
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
import {
  autoSurrenderRegionSchema,
  DEFAULT_AUTO_SURRENDER_REGION,
  type AutoSurrenderRegion
} from '@shared/shards/auto-misc/auto-surrender'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NInputNumber,
  NSwitch,
  useMessage
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

const { t } = useTranslation()
const store = useAutoMiscStore()
const autoMisc = useInstance(AutoMiscRenderer)
const appCommon = useAppCommonStore()
const message = useMessage()
const regionFields = ['x', 'y', 'width', 'height'] as const
const region = ref<Record<keyof AutoSurrenderRegion, number | null>>({
  ...store.settings.autoSurrenderRegion
})
const saving = ref(false)
const validRegion = computed(() => autoSurrenderRegionSchema.safeParse(region.value).success)
const dirty = computed(() =>
  regionFields.some((key) => region.value[key] !== store.settings.autoSurrenderRegion[key])
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

watch(
  () => store.settings.autoSurrenderRegion,
  (value) => {
    region.value = { ...value }
  }
)

async function setEnabled(value: boolean) {
  try {
    await autoMisc.setAutoSurrenderEnabled(value)
  } catch {
    message.error(t('automation.misc.autoSurrender.saveFailed'))
  }
}

async function setAlwaysCheck(value: boolean) {
  try {
    await autoMisc.setAutoSurrenderAlwaysCheck(value)
  } catch {
    message.error(t('automation.misc.autoSurrender.saveFailed'))
  }
}

function resetRegion() {
  region.value = { ...DEFAULT_AUTO_SURRENDER_REGION }
}

async function saveRegion() {
  const parsed = autoSurrenderRegionSchema.safeParse(region.value)
  if (!parsed.success || saving.value) return
  saving.value = true
  try {
    await autoMisc.setAutoSurrenderRegion(parsed.data)
    message.success(t('automation.misc.autoSurrender.saved'))
  } catch {
    message.error(t('automation.misc.autoSurrender.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>
