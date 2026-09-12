import { AggregatedAnalysis, analyzeGames } from '@shared/data-adapter/analysis/player'
import { AggregatedTeamAnalysis, analyzePlayers } from '@shared/data-adapter/analysis/team'
import { toIdentities } from '@shared/data-adapter/match-history/identities'
import { MatchBasicInfo, toBasicInfo } from '@shared/data-adapter/match-history/match-basic'
import { toParticipants } from '@shared/data-adapter/match-history/participants'
import { LcuOrSgpGameDetails, LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { MatchHistoryQueryParams } from '@shared/http-api-axios-helper/sgp/match-history-query'
import {
  OngoingGameAnalysis,
  OngoingGamePositionAssignment,
  OngoingGameSimplifiedChampMastery,
  OngoingGameSnapshot,
  QueryStageDraft
} from '@shared/shards/ongoing-game'
import type { SavedInfo } from '@shared/shards/saved-player'
import type { RankedStats } from '@shared/types/league-client/ranked'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import {
  calculateTogetherTimes,
  mergeOverlappingSets,
  removeSubsets
} from '@shared/utils/team-up-calc'

export type PreviousGameMatchHistoryEntry = {
  source: 'lcu' | 'sgp'
  params: MatchHistoryQueryParams
  data: LcuOrSgpGameSummary[]
}

/** 从最近一局比赛中提取的、用于构建快照的核心数据 */
export interface PreviousGameCore {
  basicInfo: MatchBasicInfo
  queryStage: QueryStageDraft
  teams: Record<string, string[]>
  championSelections: Record<string, number>
  positionAssignments: Record<string, OngoingGamePositionAssignment>
  spells: Record<string, { spell1Id: number; spell2Id: number }>
}

/**
 * 从最近一局的比赛概览中提取队伍、英雄选择、分路与召唤师技能等核心数据。
 *
 * 队伍与分路的归一化方式与战绩卡片的“对局分析模拟”草稿保持一致：
 * 斗魂竞技场（CHERRY）的所有玩家归入 TEAM-ALL，其余模式按 TEAM-{teamId} 分组。
 */
export function buildPreviousGameCore(latestGame: LcuOrSgpGameSummary): PreviousGameCore | null {
  const basicInfo = toBasicInfo(latestGame)
  const participants = toParticipants(latestGame, basicInfo)

  if (!participants.length) {
    return null
  }

  const isCherry = basicInfo.gameMode === 'CHERRY'
  const teams: Record<string, string[]> = {}
  const championSelections: Record<string, number> = {}
  const positionAssignments: Record<string, OngoingGamePositionAssignment> = {}
  const spells: Record<string, { spell1Id: number; spell2Id: number }> = {}
  let hasPositions = false

  for (const participant of participants) {
    if (!participant.puuid) {
      continue
    }

    const teamIdentifier = isCherry ? 'TEAM-ALL' : participant.teamIdentifier

    teams[teamIdentifier] ??= []
    teams[teamIdentifier].push(participant.puuid)
    championSelections[participant.puuid] = participant.championId
    spells[participant.puuid] = {
      spell1Id: participant.spells[0] ?? 0,
      spell2Id: participant.spells[1] ?? 0
    }

    if (participant.position) {
      positionAssignments[participant.puuid] = {
        position: participant.position,
        role: null,
        isAutofilled: false
      }
      hasPositions = true
    }
  }

  return {
    basicInfo,
    queryStage: {
      phase: 'draft',
      gameInfo: {
        queueId: basicInfo.queueId,
        queueType: isCherry ? 'CHERRY' : 'CLASSIC'
      }
    },
    teams,
    championSelections,
    positionAssignments: hasPositions ? positionAssignments : {},
    spells
  }
}

/** 与主进程 ongoing-game 分析控制一致的分析计算：按玩家聚合，再按队伍聚合 */
export function computePreviousGameAnalysis(
  matchHistory: Record<string, PreviousGameMatchHistoryEntry>,
  gameDetails: Record<number, LcuOrSgpGameDetails>,
  teams: Record<string, string[]>,
  previousAnalysis?: OngoingGameAnalysis | null
): OngoingGameAnalysis | null {
  try {
    const playerAnalyses: Record<string, AggregatedAnalysis> = {}

    for (const [puuid, matchHistoryEntry] of Object.entries(matchHistory)) {
      if (!matchHistoryEntry) {
        continue
      }

      const pairs = matchHistoryEntry.data.map((summary) => ({
        gameId: summary.gameId,
        summary,
        details: gameDetails[summary.gameId]
      }))

      const analysis = analyzeGames(pairs, puuid, {
        previous: previousAnalysis?.players[puuid]
      })

      if (analysis) {
        playerAnalyses[puuid] = analysis
      }
    }

    const teamAnalyses: Record<string, AggregatedTeamAnalysis> = {}

    for (const [teamIdentifier, puuids] of Object.entries(teams)) {
      const teamPlayerAnalyses = puuids.map((p) => playerAnalyses[p]).filter(Boolean)
      const teamAnalysis = analyzePlayers(teamPlayerAnalyses)

      if (teamAnalysis) {
        teamAnalyses[teamIdentifier] = teamAnalysis
      }
    }

    return {
      players: playerAnalyses,
      teams: teamAnalyses
    }
  } catch {
    return null
  }
}

/** 与主进程 ongoing-game 的预组队推断一致：基于各玩家历史战绩中的同队记录推断预组队 */
export function computeInferredPremadeTeams(
  matchHistory: Record<string, PreviousGameMatchHistoryEntry>,
  teams: Record<string, string[]>,
  matchCountThreshold: number
): string[][] {
  if (!Object.keys(matchHistory).length) {
    return []
  }

  const matchesByTeams = Object.values(matchHistory)
    .map((m) => {
      return m.data.map((d) => {
        const groupedByTeamId = toIdentities(d).reduce(
          (acc, i) => {
            if (!acc[i.teamId]) {
              acc[i.teamId] = []
            }
            acc[i.teamId].push(i.puuid)
            return acc
          },
          {} as Record<number, string[]>
        )

        return Object.values(groupedByTeamId)
          .filter((c) => c.length > 1)
          .map((g) => ({
            players: g,
            id: d.gameId.toString()
          }))
      })
    })
    .flat(2)

  const deduplicatedMap = new Map<string, { players: string[]; id: string }>(
    matchesByTeams.map((m) => [m.id, m])
  )

  const calculated = calculateTogetherTimes(
    Array.from(deduplicatedMap.values()),
    Object.values(teams).flat(),
    matchCountThreshold
  )

  const simplified = removeSubsets(calculated, (t) => t.players)
  const mergedOverlappingSets = mergeOverlappingSets(simplified.map((t) => t.players))

  return mergedOverlappingSets as string[][]
}

/** 与主进程 ongoing-game 的 mergedPremadeTeamMap 一致：按队伍归属为预组队分配组序号 */
export function computeMergedPremadeTeamMap(
  teams: Record<string, string[]>,
  inferredPremadeTeams: string[][]
): Record<string, number> {
  const teamIdentifierMap: Record<string, string> = {}
  for (const [teamIdentifier, puuids] of Object.entries(teams)) {
    for (const puuid of puuids) {
      teamIdentifierMap[puuid] = teamIdentifier
    }
  }

  let assignedTeamIndex = 0
  const premadeTeamMap: Record<string, number> = {}

  const simplified = removeSubsets(
    inferredPremadeTeams.filter((team) => team.length > 1),
    (team) => team
  )

  for (const puuids of simplified) {
    if (puuids.some((puuid) => teamIdentifierMap[puuid] !== teamIdentifierMap[puuids[0]])) {
      continue
    }

    const index = ++assignedTeamIndex
    for (const puuid of puuids) {
      premadeTeamMap[puuid] = index
    }
  }

  return premadeTeamMap
}

export interface PreviousGameSnapshotData {
  selfPuuid: string
  core: PreviousGameCore
  matchHistoryTagParams: { tag?: string; tagsQueryType?: 'AND' | 'OR' }
  matchHistory: Record<string, PreviousGameMatchHistoryEntry>
  matchHistoryLoadingState: Record<string, string>
  summoner: Record<string, SummonerInfo>
  rankedStats: Record<string, RankedStats>
  championMastery: Record<string, Record<number, OngoingGameSimplifiedChampMastery>>
  savedInfo: Record<string, SavedInfo>
  gameDetails: Record<number, LcuOrSgpGameDetails>
  analysis: OngoingGameAnalysis | null
  inferredPremadeTeams: string[][]
}

/** 组装与 OngoingGameSnapshot 形状一致的数据，供 createAkariPreviousGameProvider 消费 */
export function buildPreviousGameSnapshot(data: PreviousGameSnapshotData): OngoingGameSnapshot {
  const { core } = data

  const cachedGames: Record<number, LcuOrSgpGameSummary> = {}
  for (const entry of Object.values(data.matchHistory)) {
    for (const game of entry.data) {
      cachedGames[game.gameId] = game
    }
  }

  return {
    capturedAt: Date.now(),
    selfPuuid: data.selfPuuid,
    queryStage: core.queryStage,
    teams: core.teams,
    championSelections: core.championSelections,
    positionAssignments: core.positionAssignments,
    mergedPremadeTeamMap: computeMergedPremadeTeamMap(core.teams, data.inferredPremadeTeams),
    teamParticipantGroups: {},
    analysis: data.analysis,
    matchHistoryTagParams: data.matchHistoryTagParams,
    matchHistory: data.matchHistory,
    matchHistoryLoadingState: data.matchHistoryLoadingState,
    summoner: data.summoner,
    rankedStats: data.rankedStats,
    championMastery: data.championMastery,
    savedInfo: data.savedInfo,
    cachedGames,
    gameDetails: data.gameDetails,
    additional: {
      teams: {},
      selections: {},
      teamParticipantGroups: {},
      spells: core.spells,
      positions: {}
    }
  }
}
