import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { SavedPlayerRenderer } from '@renderer-shared/shards/saved-player'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { sleep } from '@shared/utils/sleep'
import { watch } from 'vue'

import { usePlayerTabsStore } from '@main-window/shards/player-tabs/store'

import {
  END_OF_GAME_INITIAL_RETRY_DELAY,
  END_OF_GAME_MAX_RETRIES,
  END_OF_GAME_RETRY_INTERVAL,
  PREVIOUS_GAME_RENDERER_NAMESPACE
} from './context'
import { createPreviousGameLoader } from './loader'
import { usePreviousGameStore } from './store'

/**
 * “上一局”的自动获取编排：
 * - 客户端连接建立或登录召唤师变化时拉取
 * - 每局游戏结束后延迟重拉（战绩入库有延迟），直到拉到新的一局或重试耗尽
 */
export function startPreviousGameController() {
  const store = usePreviousGameStore()
  const leagueClientStore = useLeagueClientStore()
  const appCommonStore = useAppCommonStore()
  const sgpStore = useSgpStore()
  const ongoingGameStore = useOngoingGameStore()
  const playerTabsStore = usePlayerTabsStore()

  const leagueClient = useInstance(LeagueClientRenderer)
  const sgp = useInstance(SgpRenderer)
  const savedPlayer = useInstance(SavedPlayerRenderer)
  const logger = useInstance(LoggerRenderer)

  const loader = createPreviousGameLoader({
    logger,
    store,
    leagueClient,
    sgp,
    savedPlayer,
    leagueClientStore,
    appCommonStore,
    sgpStore,
    ongoingGameStore,
    playerTabsStore
  })

  // 连接建立 / 换号后拉取
  let loadedForPuuid: string | null = null

  watch(
    () => [leagueClientStore.isConnected, leagueClientStore.summoner.me?.puuid] as const,
    ([isConnected, puuid]) => {
      if (!isConnected || !puuid || loadedForPuuid === puuid) {
        return
      }

      loadedForPuuid = puuid
      store.snapshot = null
      store.loadedGameId = null
      store.loadError = null

      void loader.loadPreviousGame()
    },
    { immediate: true }
  )

  // 每局游戏结束后延迟重拉，等待战绩入库
  let endOfGameToken = 0

  const reloadAfterEndOfGame = async (token: number) => {
    const gameIdBeforeEndOfGame = store.loadedGameId

    await sleep(END_OF_GAME_INITIAL_RETRY_DELAY)

    for (let attempt = 0; attempt < END_OF_GAME_MAX_RETRIES; attempt++) {
      if (token !== endOfGameToken) {
        return
      }

      await loader.loadPreviousGame()

      if (token !== endOfGameToken || store.loadedGameId !== gameIdBeforeEndOfGame) {
        return
      }

      logger.info(
        PREVIOUS_GAME_RENDERER_NAMESPACE,
        'Previous game not found in match history yet, retrying',
        attempt + 1
      )
      await sleep(END_OF_GAME_RETRY_INTERVAL)
    }

    logger.info(PREVIOUS_GAME_RENDERER_NAMESPACE, 'Previous game reload retries exhausted')
  }

  watch(
    () => leagueClientStore.gameflow.phase,
    (phase) => {
      if (phase === 'EndOfGame' || phase === 'PreEndOfGame') {
        void reloadAfterEndOfGame(++endOfGameToken)
      }
    }
  )

  const refresh = () => {
    return loader.loadPreviousGame()
  }

  return {
    refresh,
    dispose: loader.dispose
  }
}
