<template>
  <div class="in-game-send-presets-panel">
    <NTabs
      v-model:value="activePreset"
      class="preset-tabs"
      type="line"
      size="medium"
      animated
      justify-content="start"
    >
      <NTabPane :name="ratingPresetSlot" :tab="t('rating.label')">
        <RatingPresetPane />
      </NTabPane>
      <NTabPane :name="junglePresetSlot" :tab="t('jungle.label')">
        <JunglePresetPane />
      </NTabPane>
      <NTabPane :name="premadePresetSlot" :tab="t('premade.label')">
        <PremadePresetPane />
      </NTabPane>
      <NTabPane
        :name="fixedTextPresetSlot"
        :tab="t('fixedText.label')"
        display-directive="show:lazy"
      >
        <div class="min-h-140">
          <FixedTextPresetPane />
        </div>
      </NTabPane>
      <NTabPane
        :name="customTemplatePresetSlot"
        :tab="t('customTemplate.label')"
        display-directive="show:lazy"
      >
        <div class="min-h-140">
          <CustomTemplatePresetPane />
        </div>
      </NTabPane>
      <NTabPane name="ai-evaluation" :tab="t('aiEvaluation.label')" display-directive="show:lazy">
        <div class="min-h-140">
          <AiEvaluationPane />
        </div>
      </NTabPane>
      <NTabPane name="horse-grade" :tab="t('horseGrade.label')" display-directive="show:lazy">
        <div class="min-h-140">
          <HorseGradePane />
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NTabPane, NTabs } from 'naive-ui'
import { watch } from 'vue'

import { customTemplatePresetSlot } from './data/custom-template'
import { fixedTextPresetSlot } from './data/fixed-text'
import { junglePresetSlot } from './data/jungle'
import { premadePresetSlot } from './data/premade'
import { ratingPresetSlot } from './data/rating'
import { peekManualQueryRequest } from './manual-query-request'
import AiEvaluationPane from './presets-ui/AiEvaluationPane.vue'
import HorseGradePane from './presets-ui/HorseGradePane.vue'
import CustomTemplatePresetPane from './presets-ui/CustomTemplatePresetPane.vue'
import FixedTextPresetPane from './presets-ui/FixedTextPresetPane.vue'
import JunglePresetPane from './presets-ui/JunglePresetPane.vue'
import PremadePresetPane from './presets-ui/PremadePresetPane.vue'
import RatingPresetPane from './presets-ui/RatingPresetPane.vue'
import { useInGameSendPresetsPanel } from './provider'

const { t } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets' })
const { activePreset } = useInGameSendPresetsPanel()

// 战绩页发起的手动查询跳转：切换到对应预设 tab（查询本身由对应面板消费请求）
watch(
  () => peekManualQueryRequest(),
  (request) => {
    if (request) {
      activePreset.value = request.preset
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.in-game-send-presets-panel {
  max-width: 100%;
  overflow: hidden;
}

.preset-tabs :deep(.n-tabs-nav) {
  padding: 8px 12px 0;
}

.preset-tabs :deep(.n-tab-pane) {
  box-sizing: border-box;
  padding: 8px 16px 16px;
}
</style>
