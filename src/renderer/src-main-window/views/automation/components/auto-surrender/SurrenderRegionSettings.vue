<template>
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
import { useInstance } from '@renderer-shared/shards'
import { AutoMiscRenderer } from '@renderer-shared/shards/auto-misc'
import { useAutoMiscStore } from '@renderer-shared/shards/auto-misc/store'
import {
  autoSurrenderRegionSchema,
  DEFAULT_AUTO_SURRENDER_REGION,
  DEFAULT_AUTO_ACCEPT_SURRENDER_REGION,
  type AutoSurrenderRegion
} from '@shared/shards/auto-misc/auto-surrender'
import { useTranslation } from 'i18next-vue'
import { NButton, NCollapse, NCollapseItem, NInputNumber, NModal, useMessage } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import RegionSelectionCanvas from './RegionSelectionCanvas.vue'

const props = defineProps<{ mode: 'follow' | 'accept' }>()
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
const savedRegion = computed(() =>
  props.mode === 'accept'
    ? store.settings.autoAcceptSurrenderRegion
    : store.settings.autoSurrenderRegion
)
const autoMisc = useInstance(AutoMiscRenderer)
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
const validRegion = computed(() => autoSurrenderRegionSchema.safeParse(region.value).success)
const dirty = computed(() =>
  regionFields.some((key) => region.value[key] !== savedRegion.value[key])
)

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
