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
          {{
            tr('duration', {
              ms: snapshot.lastScanDurationMs
            })
          }}
        </span>
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
    <SettingsRow
      :setting-id="`${settingId}.region`"
      :label="tr('region.label')"
      :label-description="tr('region.description')"
      :label-width="260"
      align="start"
    >
      <div class="flex w-90 max-w-full flex-col gap-3">
        <RegionSelectionCanvas
          :translation-key="translationKey"
          :region="previewRegion"
          :interactive="!saving"
          @update:region="region = $event"
        />
        <span class="text-xs leading-relaxed text-(--la-color-text-primary) opacity-60">
          {{ tr('region.previewHint') }}
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <NButton size="small" quaternary :disabled="saving" @click="openPicker">
            {{ tr('region.expand') }}
          </NButton>
        </div>
        <NCollapse>
          <NCollapseItem :title="tr('region.precise')">
            <div class="grid grid-cols-2 gap-x-3 gap-y-2">
              <div v-for="field in regionFields" :key="field" class="flex flex-col gap-1">
                <span class="text-xs">{{ tr(`region.${field}`) }}</span>
                <NInputNumber
                  v-model:value="region[field]"
                  size="small"
                  :disabled="saving"
                  :min="field === 'width' || field === 'height' ? 1 : 0"
                  :max="field === 'x' || field === 'y' ? 99 : 100"
                  :precision="2"
                  :aria-label="tr(`region.${field}`)"
                >
                  <template #suffix>%</template>
                </NInputNumber>
              </div>
            </div>
          </NCollapseItem>
        </NCollapse>
        <span v-if="!validRegion" class="text-xs text-red-500">
          {{ tr('region.invalid') }}
        </span>
        <div class="flex justify-end gap-2">
          <NButton size="small" :disabled="saving" @click="resetRegion">{{
            tr('region.reset')
          }}</NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!validRegion || !dirty"
            :loading="saving"
            @click="saveRegion()"
          >
            {{ tr('region.save') }}
          </NButton>
        </div>
      </div>
    </SettingsRow>
    <NCollapse v-if="snapshot.lastText" class="px-4 pb-4">
      <NCollapseItem :title="tr('lastText')">
        <div class="text-xs break-words">{{ snapshot.lastText }}</div>
      </NCollapseItem>
    </NCollapse>
  </SettingsSection>
  <NModal
    v-model:show="showPicker"
    preset="card"
    :title="tr('region.pickerTitle')"
    :style="{
      width: `min(960px, calc(100vw - 48px), calc((100vh - 280px) * ${16 / 9}))`
    }"
    :closable="!saving"
    :mask-closable="!saving"
    :close-on-esc="!saving"
  >
    <div class="flex flex-col gap-3">
      <span class="text-xs opacity-60">{{ tr('region.pickerHint') }}</span>
      <RegionSelectionCanvas
        :translation-key="translationKey"
        v-model:region="selection"
        :interactive="!saving"
      />
      <span class="text-xs opacity-60">
        {{ tr('region.keyboardHint') }}
      </span>
    </div>
    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <NButton :disabled="saving" @click="selection = { ...defaultRegion }">
          {{ tr('region.reset') }}
        </NButton>
        <div class="flex gap-2">
          <NButton :disabled="saving" @click="showPicker = false">
            {{ tr('region.cancel') }}
          </NButton>
          <NButton type="primary" :loading="saving" @click="confirmSelection">
            {{ tr('region.confirm') }}
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
  DEFAULT_AUTO_ACCEPT_SURRENDER_REGION,
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

const props = withDefaults(defineProps<{ mode?: 'follow' | 'accept' }>(), { mode: 'follow' })
const { t } = useTranslation()
const translationKey = computed(() =>
  props.mode === 'accept' ? 'automation.misc.autoAcceptSurrender' : 'automation.misc.autoSurrender'
)
const settingId = computed(() =>
  props.mode === 'accept'
    ? 'automation.misc.auto-accept-surrender'
    : 'automation.misc.auto-surrender'
)
const tr = (key: string, options?: Record<string, unknown>) =>
  t(`${translationKey.value}.${key}`, options)
const defaultRegion = computed(() =>
  props.mode === 'accept' ? DEFAULT_AUTO_ACCEPT_SURRENDER_REGION : DEFAULT_AUTO_SURRENDER_REGION
)
const store = useAutoMiscStore()
const enabled = computed(() =>
  props.mode === 'accept'
    ? store.settings.autoAcceptSurrenderEnabled
    : store.settings.autoSurrenderEnabled
)
const savedRegion = computed(() =>
  props.mode === 'accept'
    ? store.settings.autoAcceptSurrenderRegion
    : store.settings.autoSurrenderRegion
)
const snapshot = computed(() =>
  props.mode === 'accept' ? store.autoAcceptSurrender : store.autoSurrender
)
const autoMisc = useInstance(AutoMiscRenderer)
const appCommon = useAppCommonStore()
const message = useMessage()
const regionFields = ['x', 'y', 'width', 'height'] as const
const region = ref<Record<keyof AutoSurrenderRegion, number | null>>({
  ...savedRegion.value
})
const saving = ref(false)
const showPicker = ref(false)
const selection = ref<AutoSurrenderRegion>({ ...savedRegion.value })
const previewRegion = computed(() => {
  const parsed = autoSurrenderRegionSchema.safeParse(region.value)
  return parsed.success ? parsed.data : savedRegion.value
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
    )[snapshot.value.status]
)
const validRegion = computed(() => autoSurrenderRegionSchema.safeParse(region.value).success)
const dirty = computed(() =>
  regionFields.some((key) => region.value[key] !== savedRegion.value[key])
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
  () => savedRegion.value,
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
    await (props.mode === 'accept'
      ? autoMisc.setAutoAcceptSurrenderEnabled(value)
      : autoMisc.setAutoSurrenderEnabled(value))
  } catch {
    message.error(tr('saveFailed'))
  }
}

function resetRegion() {
  region.value = { ...defaultRegion.value }
}

async function saveRegion(value = region.value) {
  const parsed = autoSurrenderRegionSchema.safeParse(value)
  if (!parsed.success || saving.value) return false
  saving.value = true
  try {
    await (props.mode === 'accept'
      ? autoMisc.setAutoAcceptSurrenderRegion(parsed.data)
      : autoMisc.setAutoSurrenderRegion(parsed.data))
    region.value = { ...parsed.data }
    message.success(tr('saved'))
    return true
  } catch {
    message.error(tr('saveFailed'))
    return false
  } finally {
    saving.value = false
  }
}
</script>
