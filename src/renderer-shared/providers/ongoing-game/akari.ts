import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { OngoingGameRenderer } from '@renderer-shared/shards/ongoing-game'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import type { OngoingGameSnapshot } from '@shared/shards/ongoing-game'
import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'

import type { OngoingGameProviderValue } from './types'

export function createAkariOngoingGameProvider(): OngoingGameProviderValue {
  const appCommon = useAppCommonStore()
  const leagueClient = useLeagueClientStore()
  const ongoingGame = useOngoingGameStore()
  const ongoingGameRenderer = useInstance(OngoingGameRenderer)

  return {
    get settings() {
      return ongoingGame.settings
    },
    get queryStage() {
      return ongoingGame.queryStage
    },
    get draft() {
      return ongoingGame.draft
    },
    get teams() {
      return ongoingGame.teams
    },
    get championSelections() {
      return ongoingGame.championSelections
    },
    get positionAssignments() {
      return ongoingGame.positionAssignments
    },
    get mergedPremadeTeamMap() {
      return ongoingGame.mergedPremadeTeamMap
    },
    get analysis() {
      return ongoingGame.analysis
    },
    get summoner() {
      return ongoingGame.summoner
    },
    get rankedStats() {
      return ongoingGame.rankedStats
    },
    get championMastery() {
      return ongoingGame.championMastery
    },
    get savedInfo() {
      return ongoingGame.savedInfo
    },
    get cachedGames() {
      return ongoingGame.cachedGames
    },
    get gameDetails() {
      return ongoingGame.gameDetails
    },
    get matchHistory() {
      return ongoingGame.matchHistory
    },
    get matchHistoryLoadingState() {
      return ongoingGame.matchHistoryLoadingState
    },
    get spells() {
      return ongoingGame.additional.spells
    },
    get isConnected() {
      return leagueClient.isConnected
    },
    get isSpectating() {
      return Boolean(leagueClient.champSelect.session?.isSpectating)
    },
    get isArchived() {
      return false
    },
    get streamerMode() {
      return appCommon.settings.streamerMode
    },
    get selfPuuid() {
      return leagueClient.summoner.me?.puuid ?? null
    },
    reloadPlayer(puuid, options) {
      ongoingGameRenderer.reloadPlayer(puuid, options)
    }
  }
}

/**
 * 上一局面板的 provider。
 *
 * 快照源可以传入 ref 或 getter（推荐），getter 在每次访问时读取最新快照，
 * 这样后台补齐时间线、切换过滤条件等重新发布快照时面板能实时更新。
 * 直接传入快照对象仍然兼容（视为固定快照）。
 */
export function createAkariPreviousGameProvider(
  snapshotSource: MaybeRefOrGetter<OngoingGameSnapshot | null>
): OngoingGameProviderValue {
  const appCommon = useAppCommonStore()
  const ongoingGame = useOngoingGameStore()

  const readSnapshot = () => {
    const snapshot = toValue(snapshotSource)

    if (!snapshot) {
      throw new Error('Previous game snapshot is not available')
    }

    return snapshot
  }

  return {
    get settings() {
      return ongoingGame.settings
    },
    get queryStage() {
      return readSnapshot().queryStage
    },
    get draft() {
      return null
    },
    get teams() {
      return readSnapshot().teams
    },
    get championSelections() {
      return readSnapshot().championSelections
    },
    get positionAssignments() {
      return readSnapshot().positionAssignments
    },
    get mergedPremadeTeamMap() {
      return readSnapshot().mergedPremadeTeamMap
    },
    get analysis() {
      return readSnapshot().analysis
    },
    get summoner() {
      return readSnapshot().summoner
    },
    get rankedStats() {
      return readSnapshot().rankedStats
    },
    get championMastery() {
      return readSnapshot().championMastery
    },
    get savedInfo() {
      return readSnapshot().savedInfo
    },
    get cachedGames() {
      return readSnapshot().cachedGames
    },
    get gameDetails() {
      return readSnapshot().gameDetails
    },
    get matchHistory() {
      return readSnapshot().matchHistory
    },
    get matchHistoryLoadingState() {
      return readSnapshot().matchHistoryLoadingState
    },
    get spells() {
      return readSnapshot().additional.spells
    },
    get isConnected() {
      return true
    },
    get isSpectating() {
      return false
    },
    get isArchived() {
      return true
    },
    get streamerMode() {
      return appCommon.settings.streamerMode
    },
    get selfPuuid() {
      return readSnapshot().selfPuuid
    },
    reloadPlayer() {}
  }
}
