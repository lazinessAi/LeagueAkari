import { Game } from '@shared/types/league-client/match-history'
import { describe, expect, it } from 'vitest'

import { buildPreviousGameCore, computeMergedPremadeTeamMap } from './snapshot-builder'

let nextParticipantId = 1

const createLcuParticipant = (options: {
  puuid: string
  teamId: number
  championId: number
  spell1Id?: number
  spell2Id?: number
}) => {
  const participantId = nextParticipantId++

  return {
    participantId,
    teamId: options.teamId,
    championId: options.championId,
    spell1Id: options.spell1Id ?? 4,
    spell2Id: options.spell2Id ?? 11,
    allInPings: 0,
    assistMePings: 0,
    basicPings: 0,
    commandPings: 0,
    dangerPings: 0,
    enemyMissingPings: 0,
    enemyVisionPings: 0,
    getBackPings: 0,
    holdPings: 0,
    needVisionPings: 0,
    onMyWayPings: 0,
    pushPings: 0,
    retreatPings: 0,
    visionClearedPings: 0,
    stats: {
      playerSubteamId: 0,
      kills: 1,
      deaths: 1,
      assists: 1,
      champLevel: 18,
      item0: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      roleBoundItem: 0,
      playerAugment1: 0,
      playerAugment2: 0,
      playerAugment3: 0,
      playerAugment4: 0,
      playerAugment5: 0,
      playerAugment6: 0,
      perk0: 0,
      perk0Var1: 0,
      perk0Var2: 0,
      perk0Var3: 0,
      perk1: 0,
      perk1Var1: 0,
      perk1Var2: 0,
      perk1Var3: 0,
      perk2: 0,
      perk2Var1: 0,
      perk2Var2: 0,
      perk2Var3: 0,
      perk3: 0,
      perk3Var1: 0,
      perk3Var2: 0,
      perk3Var3: 0,
      perk4: 0,
      perk4Var1: 0,
      perk4Var2: 0,
      perk4Var3: 0,
      perk5: 0,
      perk5Var1: 0,
      perk5Var2: 0,
      perk5Var3: 0,
      perkPrimaryStyle: 0,
      perkSubStyle: 0,
      totalDamageDealtToChampions: 10000,
      physicalDamageDealtToChampions: 5000,
      magicDamageDealtToChampions: 4000,
      trueDamageDealtToChampions: 1000,
      totalDamageTaken: 10000,
      physicalDamageTaken: 5000,
      magicalDamageTaken: 4000,
      trueDamageTaken: 1000,
      goldEarned: 10000,
      goldSpent: 9000,
      neutralMinionsKilled: 20,
      totalMinionsKilled: 100,
      win: true,
      gameEndedInEarlySurrender: false,
      gameEndedInSurrender: false,
      teamEarlySurrendered: false,
      subteamPlacement: 0,
      damageDealtToTurrets: 1000,
      totalHeal: 1000,
      visionScore: 20,
      timeCCingOthers: 10,
      doubleKills: 0,
      tripleKills: 0,
      quadraKills: 0,
      pentaKills: 0
    }
  }
}

const createLcuGame = (options: {
  gameId: number
  gameMode: string
  queueId?: number
  participants: ReturnType<typeof createLcuParticipant>[]
}) => {
  return {
    gameId: options.gameId,
    gameMode: options.gameMode,
    queueId: options.queueId ?? 450,
    mapId: 12,
    gameVersion: '1.0.0',
    gameType: 'MATCHED_GAME',
    gameCreation: 1758468000000,
    gameDuration: 1200,
    participants: options.participants,
    participantIdentities: options.participants.map((p, index) => ({
      participantId: p.participantId,
      player: {
        puuid: `puuid-${index}`,
        gameName: `name-${index}`,
        summonerName: `name-${index}`,
        tagLine: 'tag',
        profileIcon: 1
      }
    }))
  } as unknown as Game
}

describe('buildPreviousGameCore', () => {
  it('builds teams and selections for a classic two-team game', () => {
    nextParticipantId = 1
    const game = createLcuGame({
      gameId: 1,
      gameMode: 'CLASSIC',
      queueId: 420,
      participants: [
        createLcuParticipant({ puuid: 'puuid-0', teamId: 100, championId: 22, spell1Id: 7 }),
        createLcuParticipant({ puuid: 'puuid-1', teamId: 100, championId: 23 }),
        createLcuParticipant({ puuid: 'puuid-2', teamId: 200, championId: 24 }),
        createLcuParticipant({ puuid: 'puuid-3', teamId: 200, championId: 25 })
      ]
    })

    const core = buildPreviousGameCore({ source: 'lcu', gameId: 1, data: game })

    expect(core).not.toBeNull()
    expect(core!.teams).toEqual({
      'TEAM-100': ['puuid-0', 'puuid-1'],
      'TEAM-200': ['puuid-2', 'puuid-3']
    })
    expect(core!.championSelections).toEqual({
      'puuid-0': 22,
      'puuid-1': 23,
      'puuid-2': 24,
      'puuid-3': 25
    })
    expect(core!.spells['puuid-0']).toEqual({ spell1Id: 7, spell2Id: 11 })
    // LCU 战绩摘要不提供分路信息
    expect(core!.positionAssignments).toEqual({})
    expect(core!.queryStage).toEqual({
      phase: 'draft',
      gameInfo: { queueId: 420, queueType: 'CLASSIC' }
    })
  })

  it('groups all players into TEAM-ALL for a cherry game', () => {
    nextParticipantId = 1
    const game = createLcuGame({
      gameId: 2,
      gameMode: 'CHERRY',
      participants: [
        createLcuParticipant({ puuid: 'puuid-0', teamId: 100, championId: 22 }),
        createLcuParticipant({ puuid: 'puuid-1', teamId: 200, championId: 23 })
      ]
    })

    const core = buildPreviousGameCore({ source: 'lcu', gameId: 2, data: game })

    expect(core).not.toBeNull()
    expect(core!.teams).toEqual({ 'TEAM-ALL': ['puuid-0', 'puuid-1'] })
    expect(core!.queryStage.gameInfo).toEqual({ queueId: 450, queueType: 'CHERRY' })
  })
})

describe('computeMergedPremadeTeamMap', () => {
  it('assigns group indexes within the same team and skips cross-team groups', () => {
    const teams = {
      'TEAM-100': ['a', 'b', 'c'],
      'TEAM-200': ['d', 'e']
    }

    const merged = computeMergedPremadeTeamMap(teams, [
      ['a', 'b'], // 同队预组队
      ['c', 'd'] // 跨队，应被忽略
    ])

    expect(merged).toEqual({ a: 1, b: 1 })
  })
})
