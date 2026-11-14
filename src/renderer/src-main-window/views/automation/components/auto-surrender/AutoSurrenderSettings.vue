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
      <template #label>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{{ t('automation.misc.autoSurrender.enabled') }}</span>
          <NTag
            v-if="store.settings.autoSurrenderEnabled"
            size="small"
            round
            :bordered="false"
            :type="statusType"
            role="status"
          >
            <template #icon>
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            </template>
            {{ t(`automation.misc.autoSurrender.status.${store.autoSurrender.status}`) }}
          </NTag>
        </div>
      </template>
      <template
        v-if="
          store.settings.autoSurrenderEnabled && store.autoSurrender.lastScanDurationMs !== null
        "
        #labelDescription
      >
        <span class="text-xs tabular-nums">
          {{
            t('automation.misc.autoSurrender.duration', {
              ms: store.autoSurrender.lastScanDurationMs
            })
          }}
        </span>
      </template>
      <NSwitch
        size="small"
        :value="store.settings.autoSurrenderEnabled"
        :disabled="
          !appCommon.nativeSupport.nativeInput.available && !store.settings.autoSurrenderEnabled
        "
        @update:value="setEnabled"
      />
    </SettingsRow>
    <div
      v-if="unavailableReason || store.autoSurrender.error"
      class="flex flex-col gap-3 px-4 py-3"
    >
      <NAlert v-if="unavailableReason" type="warning" :show-icon="false">
        {{ unavailableReason }}
      </NAlert>
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
      <div class="flex w-90 max-w-full flex-col gap-3">
        <RegionSelectionCanvas
          :region="previewRegion"
          :interactive="!saving"
          @update:region="region = $event"
        />
        <span class="text-xs leading-relaxed text-(--la-color-text-primary) opacity-60">
          {{ t('automation.misc.autoSurrender.region.previewHint') }}
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <NButton size="small" quaternary :disabled="saving" @click="openPicker">
            {{ t('automation.misc.autoSurrender.region.expand') }}
          </NButton>
        </div>
        <NCollapse>
          <NCollapseItem :title="t('automation.misc.autoSurrender.region.precise')">
            <div class="grid grid-cols-2 gap-x-3 gap-y-2">
              <div v-for="field in regionFields" :key="field" class="flex flex-col gap-1">
                <span class="text-xs">{{
                  t(`automation.misc.autoSurrender.region.${field}`)
                }}</span>
                <NInputNumber
                  v-model:value="region[field]"
                  size="small"
                  :disabled="saving"
                  :min="field === 'width' || field === 'height' ? 1 : 0"
                  :max="field === 'x' || field === 'y' ? 99 : 100"
                  :precision="2"
                  :aria-label="t(`automation.misc.autoSurrender.region.${field}`)"
                >
                  <template #suffix>%</template>
                </NInputNumber>
              </div>
            </div>
          </NCollapseItem>
        </NCollapse>
        <span v-if="!validRegion" class="text-xs text-red-500">
          {{ t('automation.misc.autoSurrender.region.invalid') }}
        </span>
        <div class="flex justify-end gap-2">
          <NButton size="small" :disabled="saving" @click="resetRegion">{{
            t('automation.misc.autoSurrender.region.reset')
          }}</NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!validRegion || !dirty"
            :loading="saving"
            @click="saveRegion()"
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
  <NModal
    v-model:show="showPicker"
    preset="card"
    :title="t('automation.misc.autoSurrender.region.pickerTitle')"
    :style="{
      width: `min(960px, calc(100vw - 48px), calc((100vh - 280px) * ${16 / 9}))`
    }"
    :closable="!saving"
    :mask-closable="!saving"
    :close-on-esc="!saving"
  >
    <div class="flex flex-col gap-3">
      <span class="text-xs opacity-60">{{
        t('automation.misc.autoSurrender.region.pickerHint')
      }}</span>
      <RegionSelectionCanvas v-model:region="selection" :interactive="!saving" />
      <span class="text-xs opacity-60">
        {{ t('automation.misc.autoSurrender.region.keyboardHint') }}
      </span>
    </div>
    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <NButton :disabled="saving" @click="selection = { ...DEFAULT_AUTO_SURRENDER_REGION }">
          {{ t('automation.misc.autoSurrender.region.reset') }}
        </NButton>
        <div class="flex gap-2">
          <NButton :disabled="saving" @click="showPicker = false">
            {{ t('automation.misc.autoSurrender.region.cancel') }}
          </NButton>
          <NButton type="primary" :loading="saving" @click="confirmSelection">
            {{ t('automation.misc.autoSurrender.region.confirm') }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
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
  NModal,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

import RegionSelectionCanvas from './RegionSelectionCanvas.vue'

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
const showPicker = ref(false)
const selection = ref<AutoSurrenderRegion>({ ...store.settings.autoSurrenderRegion })
const previewRegion = computed(() => {
  const parsed = autoSurrenderRegionSchema.safeParse(region.value)
  return parsed.success ? parsed.data : store.settings.autoSurrenderRegion
})
const statusType = computed(
  () =>
    (
      ({
        idle: 'default',
        starting: 'info',
        watching: 'success',
        paused: 'warning',
        triggered: 'success',
        unavailable: 'warning',
        error: 'error'
      }) as const
    )[store.autoSurrender.status]
)
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

function openPicker() {
  selection.value = { ...previewRegion.value }
  showPicker.value = true
}

async function confirmSelection() {
  if (await saveRegion(selection.value)) showPicker.value = false
}

async function setEnabled(value: boolean) {
  try {
    await autoMisc.setAutoSurrenderEnabled(value)
  } catch {
    message.error(t('automation.misc.autoSurrender.saveFailed'))
  }
}

function resetRegion() {
  region.value = { ...DEFAULT_AUTO_SURRENDER_REGION }
}

async function saveRegion(value = region.value) {
  const parsed = autoSurrenderRegionSchema.safeParse(value)
  if (!parsed.success || saving.value) return false
  saving.value = true
  try {
    await autoMisc.setAutoSurrenderRegion(parsed.data)
    region.value = { ...parsed.data }
    message.success(t('automation.misc.autoSurrender.saved'))
    return true
  } catch {
    message.error(t('automation.misc.autoSurrender.saveFailed'))
    return false
  } finally {
    saving.value = false
  }
}
</script>
