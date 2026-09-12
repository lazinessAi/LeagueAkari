import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { SavedPlayerRenderer } from '@renderer-shared/shards/saved-player'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { LcuOrSgpGameDetails, LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { OngoingGameSimplifiedChampMastery } from '@shared/shards/ongoing-game'
import { SavedInfo } from '@shared/shards/saved-player'
import type { Game } from '@shared/types/league-client/match-history'
import type { RankedStats } from '@shared/types/league-client/ranked'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import { isAxiosError } from 'axios'
import PQueue from 'p-queue'
import QuickLRU from 'quick-lru'

import { usePlayerTabsStore } from '@main-window/shards/player-tabs/store'

import { PREVIOUS_GAME_RENDERER_NAMESPACE } from './context'
import {
  PreviousGameMatchHistoryEntry,
  buildPreviousGameCore,
  buildPreviousGameSnapshot,
  computeInferredPremadeTeams,
  computePreviousGameAnalysis
} from './snapshot-builder'
import { usePreviousGameStore } from './store'

type PreviousGameStore = ReturnType<typeof usePreviousGameStore>

export interface PreviousGameLoaderContext {
  logger: LoggerRenderer
  store: PreviousGameStore
  leagueClient: LeagueClientRenderer
  sgp: SgpRenderer
  savedPlayer: SavedPlayerRenderer
  leagueClientStore: ReturnType<typeof useLeagueClientStore>
  appCommonStore: ReturnType<typeof useAppCommonStore>
  sgpStore: ReturnType<typeof useSgpStore>
  ongoingGameStore: ReturnType<typeof useOngoingGameStore>
  playerTabsStore: ReturnType<typeof usePlayerTabsStore>
}

interface PreviousGameCollectedData {
  matchHistory: Record<string, PreviousGameMatchHistoryEntry>
  matchHistoryLoadingState: Record<string, string>
  summoner: Record<string, SummonerInfo>
  rankedStats: Record<string, RankedStats>
  championMastery: Record<string, Record<number, OngoingGameSimplifiedChampMastery>>
  savedInfo: Record<string, SavedInfo>
}

type DataSource = { type: 'sgp'; sgpServerId: string } | { type: 'lcu' }

/**
 * “上一局”数据加载器。
 *
 * 拉取当前召唤师最近一局比赛，并为其所有参与者加载战绩、排位、熟练度、
 * 召唤师信息与标记数据，最终组装为 OngoingGameSnapshot 形状的快照。
 * 时间线详情（打野路径数据）在快照发布后于后台补齐，按批次重新发布快照。
 */
export function createPreviousGameLoader(context: PreviousGameLoaderContext) {
  const { logger, store } = context

  /** 加载代次，用于丢弃过期的异步结果 */
  let generation = 0

  const playerTaskQueue = new PQueue({ concurrency: 3 })
  const lcuCompleteGameQueue = new PQueue({ concurrency: 10 })
  const gameDetailsQueue = new PQueue({ concurrency: 3 })
  const gameDetailsLruMap = new QuickLRU<string, LcuOrSgpGameDetails>({ maxSize: 256 })

  const resolveDataSource = (): DataSource => {
    const { availability, isTokenReady } = context.sgpStore

    if (
      context.appCommonStore.settings.preferredLolSource === 'sgp' &&
      availability.serversSupported.matchHistory &&
      isTokenReady &&
      availability.sgpServerId
    ) {
      return { type: 'sgp', sgpServerId: availability.sgpServerId }
    }

    return { type: 'lcu' }
  }

  const completeLcuGame = async (game: Game): Promise<LcuOrSgpGameSummary> => {
    const cached = context.playerTabsStore.gameSummaryLruMap.get(`lcu:${game.gameId}`)
    if (cached) {
      return cached
    }

    try {
      const { data } = await lcuCompleteGameQueue.add(() =>
        context.leagueClient.api.matchHistory.getGame(game.gameId)
      )
      return { source: 'lcu', data, gameId: game.gameId }
    } catch {
      return { source: 'lcu', data: game, gameId: game.gameId }
    }
  }

  const fetchMatchHistory = async (
    puuid: string,
    source: DataSource,
    count: number,
    tagParams: { tag?: string; tagsQueryType?: 'AND' | 'OR' } = {}
  ): Promise<PreviousGameMatchHistoryEntry> => {
    const params = { startIndex: 0, count }

    if (source.type === 'sgp') {
      const { data } = await context.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(
        puuid,
        { ...params, ...tagParams, __sgpServerId: source.sgpServerId }
      )

      const games: LcuOrSgpGameSummary[] = data.games
        .filter((g) => g.json) // 有时候服务器内容错误，没有这个 json 字段，原因不明
        .map((g) => ({ source: 'sgp', data: g, gameId: g.json.gameId }))

      return { source: 'sgp', params: { ...params, ...tagParams }, data: games }
    }

    const { data } = await context.leagueClient.api.matchHistory.getMatchHistory(
      puuid,
      params.startIndex,
      params.count - 1
    )

    const baseGames = data.games.games.filter((g) => !!g && typeof g.gameId === 'number')
    const games = await Promise.all(baseGames.map((g) => completeLcuGame(g)))

    games.forEach((g) => {
      context.playerTabsStore.gameSummaryLruMap.set(`lcu:${g.gameId}`, g)
    })

    return { source: 'lcu', params, data: games }
  }

  const querySavedInfo = async (puuid: string, selfPuuid: string): Promise<SavedInfo | null> => {
    const auth = context.leagueClientStore.auth

    if (!auth) {
      return null
    }

    try {
      return await context.savedPlayer.querySavedPlayerWithGames({
        puuid,
        selfPuuid,
        region: auth.region,
        rsoPlatformId: auth.rsoPlatformId
      })
    } catch (error) {
      logger.warn(PREVIOUS_GAME_RENDERER_NAMESPACE, 'Failed to query saved info', puuid, error)
      return null
    }
  }

  const loadChampionMastery = async (puuid: string) => {
    const { data } = await context.leagueClient.api.championMastery.getPlayerChampionMastery(puuid)

    return data
      .map((m) => ({
        championId: m.championId,
        championLevel: m.championLevel,
        championPoints: m.championPoints,
        championSeasonMilestone: m.championSeasonMilestone,
        highestGrade: m.highestGrade,
        lastPlayTime: m.lastPlayTime
      }))
      .reduce(
        (obj, cur) => {
          obj[cur.championId] = cur
          return obj
        },
        {} as Record<number, OngoingGameSimplifiedChampMastery>
      )
  }

  const loadPlayerData = async (
    puuid: string,
    selfPuuid: string,
    selfMatchHistory: PreviousGameMatchHistoryEntry,
    source: DataSource,
    matchHistoryCount: number,
    tagParams: { tag?: string; tagsQueryType?: 'AND' | 'OR' },
    data: PreviousGameCollectedData
  ) => {
    const [matchHistory, summoner, rankedStats, championMastery, savedInfo] =
      await Promise.allSettled([
        puuid === selfPuuid
          ? Promise.resolve(selfMatchHistory)
          : fetchMatchHistory(puuid, source, matchHistoryCount, tagParams),
        context.leagueClient.api.summoner.getSummonerByPuuid(puuid),
        context.leagueClient.api.ranked.getRankedStats(puuid),
        loadChampionMastery(puuid),
        querySavedInfo(puuid, selfPuuid)
      ])

    if (matchHistory.status === 'fulfilled') {
      data.matchHistory[puuid] = matchHistory.value
      data.matchHistoryLoadingState[puuid] = 'loaded'
    } else {
      logger.warn(
        PREVIOUS_GAME_RENDERER_NAMESPACE,
        'Failed to load player match history',
        puuid,
        matchHistory.reason
      )
      data.matchHistoryLoadingState[puuid] = 'error'
    }

    if (summoner.status === 'fulfilled') {
      data.summoner[puuid] = summoner.value.data
    } else {
      logger.warn(
        PREVIOUS_GAME_RENDERER_NAMESPACE,
        'Failed to load player summoner info',
        puuid,
        summoner.reason
      )
    }

    if (rankedStats.status === 'fulfilled') {
      data.rankedStats[puuid] = rankedStats.value.data
    } else {
      logger.warn(
        PREVIOUS_GAME_RENDERER_NAMESPACE,
        'Failed to load player ranked stats',
        puuid,
        rankedStats.reason
      )
    }

    if (championMastery.status === 'fulfilled') {
      data.championMastery[puuid] = championMastery.value
    } else {
      logger.warn(
        PREVIOUS_GAME_RENDERER_NAMESPACE,
        'Failed to load player champion mastery',
        puuid,
        championMastery.reason
      )
    }

    if (savedInfo.status === 'fulfilled' && savedInfo.value) {
      data.savedInfo[puuid] = savedInfo.value
    }
  }

  const republishWithGameDetails = (
    details: Record<number, LcuOrSgpGameDetails>,
    expectedGeneration: number
  ) => {
    // 加载代次已推进（发起了新的加载或已销毁），丢弃过期的重发布
    if (expectedGeneration !== generation) {
      return
    }

    const current = store.snapshot
    if (!current) {
      return
    }

    const analysis = computePreviousGameAnalysis(
      current.matchHistory,
      details,
      current.teams,
      current.analysis
    )

    store.snapshot = {
      ...current,
      gameDetails: { ...details },
      analysis
    }
  }

  const loadTimelines = async (
    matchHistory: Record<string, PreviousGameMatchHistoryEntry>,
    source: DataSource
  ) => {
    const expectedGeneration = generation
    store.isTimelineLoading = true

    try {
      const count = context.ongoingGameStore.settings.gameDetailsLoadCount
      const gameIds = [
        ...new Set(
          Object.values(matchHistory).flatMap((entry) =>
            entry.data.slice(0, count).map((g) => g.gameId)
          )
        )
      ]

      const details: Record<number, LcuOrSgpGameDetails> = {}
      let republishTimer: ReturnType<typeof setTimeout> | null = null

      const scheduleRepublish = () => {
        if (republishTimer) {
          clearTimeout(republishTimer)
        }
        republishTimer = setTimeout(
          () => republishWithGameDetails(details, expectedGeneration),
          1000
        )
      }

      await Promise.all(
        gameIds.map((gameId) =>
          gameDetailsQueue.add(async () => {
            if (expectedGeneration !== generation) {
              return
            }

            const existing = details[gameId] ?? store.snapshot?.gameDetails[gameId]
            if (existing && existing.source === source.type) {
              details[gameId] = existing
              return
            }

            try {
              let wrappedGame: LcuOrSgpGameDetails

              if (source.type === 'sgp') {
                const cached = gameDetailsLruMap.get(`sgp:${gameId}`)
                if (cached) {
                  wrappedGame = cached
                } else {
                  const { data } = await context.sgp.api.matchHistoryQuery.getGameDetailsByGameId(
                    gameId,
                    { __sgpServerId: source.sgpServerId }
                  )
                  wrappedGame = { source: 'sgp', gameId, data }
                }
              } else {
                const cached = gameDetailsLruMap.get(`lcu:${gameId}`)
                if (cached) {
                  wrappedGame = cached
                } else {
                  const { data } = await context.leagueClient.api.matchHistory.getTimeline(gameId)
                  wrappedGame = { source: 'lcu', gameId, data }
                }
              }

              gameDetailsLruMap.set(`${source.type}:${gameId}`, wrappedGame)
              details[gameId] = wrappedGame
              scheduleRepublish()
            } catch (error) {
              logger.warn(
                PREVIOUS_GAME_RENDERER_NAMESPACE,
                'Failed to load game timeline',
                gameId,
                error
              )
            }
          })
        )
      )

      if (republishTimer) {
        clearTimeout(republishTimer)
      }
      republishWithGameDetails(details, expectedGeneration)
    } finally {
      if (expectedGeneration === generation) {
        store.isTimelineLoading = false
      }
    }
  }

  const loadPreviousGame = async (): Promise<{ ok: boolean }> => {
    if (store.isLoading) {
      return { ok: true }
    }

    const me = context.leagueClientStore.summoner.me
    const auth = context.leagueClientStore.auth

    if (!me || !auth) {
      return { ok: true }
    }

    const currentGeneration = ++generation
    store.isLoading = true
    store.loadError = null

    try {
      const source = resolveDataSource()
      const matchHistoryCount = context.ongoingGameStore.settings.matchHistoryLoadCount

      // 发现“最近一局”时不带过滤条件，否则会被当前过滤 tag 掩盖
      const discoveredHistory = await fetchMatchHistory(me.puuid, source, matchHistoryCount)
      if (currentGeneration !== generation) {
        return { ok: true }
      }

      const latestGame = discoveredHistory.data[0]
      if (!latestGame) {
        store.snapshot = null
        store.loadedGameId = null
        return { ok: true }
      }

      const core = buildPreviousGameCore(latestGame)
      if (!core) {
        store.loadError = 'invalid-game-data'
        return { ok: false }
      }

      // 加载到新的一局时，默认按这一局的队列类型过滤战绩（仅 SGP 数据源支持）；
      // 同一局内重新加载（如手动切换过滤条件）则保持当前选择
      if (store.loadedGameId !== latestGame.gameId) {
        store.matchHistoryTagParams =
          source.type === 'sgp' ? { tag: `q_${core.basicInfo.queueId}`, tagsQueryType: 'AND' } : {}
      }

      const tagParams = source.type === 'sgp' ? store.matchHistoryTagParams : {}

      // 面板中自己的战绩列表也要与其他玩家一致地按过滤条件展示
      let selfMatchHistory = discoveredHistory
      if (source.type === 'sgp' && tagParams.tag) {
        selfMatchHistory = await fetchMatchHistory(me.puuid, source, matchHistoryCount, tagParams)
        if (currentGeneration !== generation) {
          return { ok: true }
        }
      }

      const puuids = [...new Set(Object.values(core.teams).flat())]
      const data: PreviousGameCollectedData = {
        matchHistory: {},
        matchHistoryLoadingState: {},
        summoner: {},
        rankedStats: {},
        championMastery: {},
        savedInfo: {}
      }

      await Promise.all(
        puuids.map((puuid) =>
          playerTaskQueue.add(() =>
            loadPlayerData(
              puuid,
              me.puuid,
              selfMatchHistory,
              source,
              matchHistoryCount,
              tagParams,
              data
            )
          )
        )
      )
      if (currentGeneration !== generation) {
        return { ok: true }
      }

      const analysis = computePreviousGameAnalysis(data.matchHistory, {}, core.teams, null)
      const inferredPremadeTeams = computeInferredPremadeTeams(
        data.matchHistory,
        core.teams,
        context.ongoingGameStore.settings.premadeTeamInferMatchCountThreshold
      )

      store.snapshot = buildPreviousGameSnapshot({
        selfPuuid: me.puuid,
        core,
        matchHistoryTagParams: tagParams,
        matchHistory: data.matchHistory,
        matchHistoryLoadingState: data.matchHistoryLoadingState,
        summoner: data.summoner,
        rankedStats: data.rankedStats,
        championMastery: data.championMastery,
        savedInfo: data.savedInfo,
        gameDetails: {},
        analysis,
        inferredPremadeTeams
      })
      store.loadedGameId = latestGame.gameId

      void loadTimelines(data.matchHistory, source)

      return { ok: true }
    } catch (error) {
      if (currentGeneration !== generation) {
        return { ok: true }
      }

      logger.warn(PREVIOUS_GAME_RENDERER_NAMESPACE, 'Failed to load previous game', error)
      store.loadError = isAxiosError(error) ? error.message : String(error)
      return { ok: false }
    } finally {
      if (currentGeneration === generation) {
        store.isLoading = false
      }
    }
  }

  const dispose = () => {
    generation++
    playerTaskQueue.clear()
    lcuCompleteGameQueue.clear()
    gameDetailsQueue.clear()
  }

  return {
    loadPreviousGame,
    dispose
  }
}
