<template>
  <div class="h-full">
    <ConnectedMatchPreviewer
      v-model:show="showPreviewModal"
      :game-id="previewingGame.gameId"
      :source="previewingGame.source"
      :puuid="previewingGame.puuid"
      :summary="previewingGame.summary"
      :details="previewingGame.details"
      :hide-privacy="as.settings.streamerMode"
      can-dry-run-ongoing-game
      @navigate-to-summoner-by-puuid="navigateToTabByPuuid"
      @dry-run-ongoing-game="handleDryRunOngoingGame"
    />
    <NTabs
      v-model:value="pgs.activeTab"
      class="ongoing-game-tabs"
      type="line"
      size="small"
      :animated="false"
    >
      <NTabPane name="current" :tab="t('ongoingGame.tabs.current')" display-directive="show">
        <OngoingGameProvider :value="ongoingGame">
          <OngoingGamePanel
            :content-width="contentWidth"
            :content-height="panelContentHeight"
            @navigate-to-summoner-by-puuid="navigateToTabByPuuid"
            @preview-game="handlePreviewGame"
          />
        </OngoingGameProvider>
      </NTabPane>

      <NTabPane name="previous" :tab="t('ongoingGame.tabs.previous')" display-directive="show">
        <OngoingGameProvider v-if="pgs.snapshot" :value="previousGameProvider">
          <OngoingGamePanel
            :content-width="contentWidth"
            :content-height="panelContentHeight"
            @navigate-to-summoner-by-puuid="navigateToTabByPuuid"
            @preview-game="handlePreviewGame"
          />
        </OngoingGameProvider>
        <div v-else class="flex h-full items-center justify-center">
          <NSpin v-if="pgs.isLoading" size="small" />
          <NEmpty
            v-else-if="pgs.loadError"
            size="small"
            :description="t('ongoingGame.tabs.loadFailed')"
          >
            <template #extra>
              <NButton size="tiny" secondary @click="refreshPreviousGame">
                {{ t('ongoingGame.tabs.retry') }}
              </NButton>
            </template>
          </NEmpty>
          <NEmpty v-else size="small" :description="t('ongoingGame.tabs.noPrevious')" />
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>

<script lang="ts" setup>
import ConnectedMatchPreviewer from '@renderer-shared/components/match-preview/ConnectedMatchPreviewer.vue'
import OngoingGamePanel from '@renderer-shared/components/ongoing-game-panel/OngoingGamePanel.vue'
import {
  createAkariOngoingGameProvider,
  createAkariPreviousGameProvider,
  OngoingGameProvider
} from '@renderer-shared/providers/ongoing-game'
import {
  type MatchPreviewPayload,
  type MatchPreviewState,
  toMatchPreviewState
} from '@renderer-shared/components/match-preview'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { OngoingGameRenderer } from '@renderer-shared/shards/ongoing-game'
import { DraftOptions } from '@shared/shards/ongoing-game'
import { useTranslation } from 'i18next-vue'
import { NButton, NEmpty, NTabPane, NTabs, NSpin } from 'naive-ui'
import { computed, ref, shallowRef } from 'vue'

import { useMainWindowAppContext } from '@main-window/context'
import { PlayerTabsRenderer } from '@main-window/shards/player-tabs'
import { PreviousGameRenderer } from '@main-window/shards/previous-game'
import { usePreviousGameStore } from '@main-window/shards/previous-game/store'

const { contentWidth, contentHeight } = useMainWindowAppContext()

const pt = useInstance(PlayerTabsRenderer)
const og = useInstance(OngoingGameRenderer)
const previousGame = useInstance(PreviousGameRenderer)
const pgs = usePreviousGameStore()
const { t } = useTranslation()
const ongoingGame = createAkariOngoingGameProvider()
const panelContentHeight = computed(() => Math.max(0, contentHeight.value - 40))
// provider 只创建一次，getters 实时读取 store 中的最新快照；
// 若每次快照更新都重建 provider，子组件注入的仍是挂载时的旧对象，界面不会刷新
const previousGameProvider = createAkariPreviousGameProvider(() => pgs.snapshot)

const as = useAppCommonStore()

const { navigateToTabByPuuid } = pt.useNavigateToTab()

const showPreviewModal = ref(false)
const previewingGame = shallowRef<MatchPreviewState>({
  gameId: 0,
  source: 'sgp'
})

const handlePreviewGame = (payload: MatchPreviewPayload) => {
  previewingGame.value = toMatchPreviewState(payload, as.settings.preferredLolSource)
  showPreviewModal.value = true
}

const handleDryRunOngoingGame = async (draft: DraftOptions) => {
  await og.setDraft(draft)
  showPreviewModal.value = false
}

const refreshPreviousGame = () => {
  void previousGame.refresh()
}
</script>

<style scoped>
.ongoing-game-tabs {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.ongoing-game-tabs > :deep(.n-tabs-nav) {
  flex-shrink: 0;
  padding: 0 1rem;
  border-bottom: 1px solid color-mix(in oklch, var(--la-color-text-primary) 10%, transparent);
}

.ongoing-game-tabs > :deep(.n-tab-pane) {
  box-sizing: border-box;
  height: 0;
  min-height: 0;
  flex: 1 1 0;
  overflow: hidden;
}
</style>
