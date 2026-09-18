import { describe, expect, it } from 'vitest'

import { buildHorseGradeReport, gradeToPercentile } from './horse-grade'
import type { HorseGradeGameJson } from './horse-grade'

const CHAMPIONS: Record<number, { roles?: string[] }> = {
  22: { roles: ['marksman'] }, // 女警 -> carry
  238: { roles: ['assassin'] }, // 劫 -> carry
  33: { roles: ['tank'] }, // 慎 -> 前排
  64: { roles: ['fighter', 'tank'] }, // 蛮王/武器 -> 战士
  43: { roles: ['support'] } // 卡尔玛 -> 辅助
}

function makeGame(
  gameId: number,
  participants: {
    puuid: string
    championId: number
    win: boolean
    kills: number
    deaths: number
    assists: number
    dmg: number
    gold: number
    taken: number
  }[]
): HorseGradeGameJson {
  return {
    gameId,
    gameCreation: 1_700_000_000_000 + gameId,
    gameDuration: 720_000,
    queueId: 2400,
    endOfGameResult: 'GameComplete',
    participants: participants.map((p, i) => ({
      puuid: p.puuid,
      participantId: i + 1,
      teamId: (i % 2) as number,
      championId: p.championId,
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      totalDamageDealtToChampions: p.dmg,
      totalDamageTaken: p.taken,
      goldEarned: p.gold
    })),
    teams: [
      { teamId: 0, win: participants[0].win },
      { teamId: 1, win: !participants[0].win }
    ]
  } as unknown as HorseGradeGameJson
}

describe('buildHorseGradeReport', () => {
  it('returns null when there are no games', () => {
    expect(buildHorseGradeReport({ players: [], games: [], champions: CHAMPIONS })).toBeNull()
  })

  it('grades players into the five bands by composite score', () => {
    // 构造 12 名玩家 × 12 场：强玩家稳定碾压，弱玩家稳定送头
    const strong = Array.from({ length: 12 }, (_, i) => ({
      puuid: `strong-${i}`,
      championId: 22
    }))
    const weak = Array.from({ length: 12 }, (_, i) => ({
      puuid: `weak-${i}`,
      championId: 33
    }))

    const games: HorseGradeGameJson[] = []
    for (let round = 0; round < 12; round++) {
      const participants = [...strong, ...weak].map((p, i) => ({
        puuid: p.puuid,
        championId: p.championId,
        // 前 12 名（强玩家）全在 team 0 且全胜；后 12 名（弱玩家）全败
        teamId: i < 12 ? 0 : 1,
        win: i < 12,
        kills: p.puuid.startsWith('strong') ? 15 + (i % 5) : i % 2,
        deaths: p.puuid.startsWith('strong') ? i % 2 : 15 + (i % 5),
        assists: p.puuid.startsWith('strong') ? 8 : i % 3,
        dmg:
          p.puuid === 'strong-0'
            ? 80000
            : p.puuid.startsWith('strong')
              ? 30000 + (i % 7) * 3000
              : 2000 + (i % 4) * 500,
        gold: p.puuid.startsWith('strong') ? 11000 : 12000 + (i % 5) * 300,
        taken: p.puuid.startsWith('strong') ? 9000 + (i % 6) * 800 : 10000 + (i % 3) * 900
      }))
      // 强队 (偶数位) 全赢

      games.push(makeGame(1000 + round, participants))
    }

    const report = buildHorseGradeReport({
      players: [
        { puuid: 'strong-0', name: '强' },
        { puuid: 'weak-0', name: '弱' }
      ],
      games,
      champions: CHAMPIONS
    })

    expect(report).not.toBeNull()
    const strongPlayer = report!.players.find((p) => p.puuid === 'strong-0')!
    const weakPlayer = report!.players.find((p) => p.puuid === 'weak-0')!

    expect(strongPlayer.score).toBeGreaterThan(weakPlayer.score)
    expect(['马头', '上等马']).toContain(strongPlayer.grade)
    expect(['下等马', '牛马']).toContain(weakPlayer.grade)
  })

  it('marks players without games as 中等马 with the population mean score', () => {
    const participants = Array.from({ length: 10 }, (_, i) => ({
      puuid: `p-${i}`,
      championId: 22,
      win: i % 2 === 0,
      kills: 5,
      deaths: 5,
      assists: 5,
      dmg: 10000,
      gold: 10000,
      taken: 10000
    }))

    const report = buildHorseGradeReport({
      players: [{ puuid: 'nobody', name: '局外人' }],
      games: [makeGame(1, participants)],
      champions: CHAMPIONS
    })

    expect(report).not.toBeNull()
    expect(report!.players[0].grade).toBe('中等马')
    expect(report!.players[0].score).toBeCloseTo(report!.population.compositeMean, 5)
  })
})

describe('gradeToPercentile', () => {
  it('maps z scores to percentile', () => {
    expect(gradeToPercentile(0)).toBe(50)
    expect(gradeToPercentile(2)).toBeGreaterThan(95)
    expect(gradeToPercentile(-2)).toBeLessThan(5)
  })
})
