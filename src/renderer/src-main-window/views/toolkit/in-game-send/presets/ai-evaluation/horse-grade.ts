import type { AramMayhemChampionInfo, AramMayhemGameJson } from './aggregate'

export type { AramMayhemGameJson, AramMayhemChampionInfo }

export interface HorseGradeGameJson extends AramMayhemGameJson {
  participants: (AramMayhemGameJson['participants'][number] & {
    puuid?: string
    championId: number
    teamId: number
  })[]
  teams?: { teamId: number; win?: unknown; objectives?: { tower?: { kills?: number } } }[]
}

export type HorseGradeChampionInfo = AramMayhemChampionInfo

/**
 * 海斗马种评价（纯函数）。
 *
 * 模型：以所有选中玩家对局中的全部参与者为总体，按定位分桶计算
 * 各指标的均值/标准差（正态分布），将每名玩家的综合 z 评分映射到
 * 马头 / 上等马 / 中等马 / 下等马 / 牛马 五档。
 */

export type HorseGrade = '马头' | '上等马' | '中等马' | '下等马' | '牛马'

/** 参与马种评定的指标权重（忽略辅助位数据） */
const METRIC_WEIGHTS = {
  winRate: 3,
  kda: 3,
  carryDge: 3,
  frontlineTaken: 1.5,
  fighterDge: 1.5,
  fighterTaken: 1.5
} as const

export const HORSE_GRADE_ORDER: HorseGrade[] = ['马头', '上等马', '中等马', '下等马', '牛马']

export interface HorseGradePlayerInput {
  puuid: string
  name: string
}

interface ParticipantRecord {
  puuid: string
  win: boolean
  kda: number
  bucket: 'carry' | 'fighter' | 'frontline' | 'support' | 'other'
  /** 伤转率：伤害占全队比例 ÷ 经济占全队比例 */
  damageGoldEfficiency: number
  /** 承伤占比 */
  takenShare: number
}

function stat(participant: Record<string, any>, key: string): number {
  return participant.stats ? (participant.stats[key] ?? 0) : (participant[key] ?? 0)
}

function isWin(participant: Record<string, any>, game: AramMayhemGameJson): boolean {
  if (participant.win !== undefined && participant.win !== null) {
    return participant.win === true || participant.win === 'Win'
  }

  const teamEntry = game.teams?.find((t) => t.teamId === participant.teamId)
  return teamEntry ? teamEntry.win === 'Win' || teamEntry.win === true : false
}

function resolveBucket(roles: string[]): ParticipantRecord['bucket'] {
  if (roles.includes('tank') && roles.includes('fighter')) return 'fighter'
  if (roles.includes('tank')) return 'frontline'
  if (roles.includes('support')) return 'support'
  if (
    roles.includes('marksman') ||
    roles.includes('mage') ||
    roles.includes('assassin') ||
    roles.includes('fighter')
  ) {
    return 'carry'
  }
  return 'other'
}

interface Pool {
  mean: number
  std: number
}

function makePool(values: number[]): Pool | null {
  if (values.length < 10) return null

  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)

  return std > 1e-9 ? { mean, std } : null
}

function zOf(value: number, pool: Pool): number {
  return (value - pool.mean) / pool.std
}

/** 正态分布 CDF 的近似（Zelen & Severo） */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const pdf = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)

  return z >= 0 ? 1 - pdf * poly : pdf * poly
}

export function gradeToPercentile(z: number): number {
  return Math.round(normalCdf(z) * 100)
}

function round(v: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** 从单场对局提取全部参与者的指标记录 */
function collectRecords(
  game: AramMayhemGameJson,
  champions: Record<number, HorseGradeChampionInfo>
): ParticipantRecord[] {
  const records: ParticipantRecord[] = []

  for (const participant of game.participants) {
    const allies = game.participants.filter((p) => p.teamId === participant.teamId)
    const teamDmg = allies.reduce((sum, p) => sum + stat(p, 'totalDamageDealtToChampions'), 0)
    const teamTaken = allies.reduce((sum, p) => sum + stat(p, 'totalDamageTaken'), 0)
    const teamGold = allies.reduce((sum, p) => sum + stat(p, 'goldEarned'), 0)
    const myDmg = stat(participant, 'totalDamageDealtToChampions')
    const myGold = stat(participant, 'goldEarned')
    const myTaken = stat(participant, 'totalDamageTaken')

    const kills = stat(participant, 'kills')
    const deaths = stat(participant, 'deaths')
    const assists = stat(participant, 'assists')
    const roles = champions[participant.championId]?.roles ?? []

    records.push({
      puuid: (participant as { puuid?: string }).puuid ?? '',
      win: isWin(participant, game),
      kda: (kills + assists) / Math.max(1, deaths),
      bucket: resolveBucket(roles),
      damageGoldEfficiency:
        teamDmg > 0 && myGold > 0 ? myDmg / teamDmg / (myGold / Math.max(1, teamGold)) : 0,
      takenShare: teamTaken > 0 ? myTaken / teamTaken : 0
    })
  }

  return records
}

function aggregateRecords(records: ParticipantRecord[]) {
  const meanOf = (
    list: ParticipantRecord[],
    key: 'damageGoldEfficiency' | 'takenShare'
  ): number | null => (list.length ? list.reduce((sum, r) => sum + r[key], 0) / list.length : null)

  const byBucket = (bucket: string) => records.filter((r) => r.bucket === bucket)

  return {
    gameCount: records.length,
    winRate: records.length
      ? records.reduce((sum, r) => sum + (r.win ? 1 : 0), 0) / records.length
      : 0,
    kda: records.length ? records.reduce((sum, r) => sum + r.kda, 0) / records.length : 0,
    carryDge: meanOf(byBucket('carry'), 'damageGoldEfficiency'),
    frontlineTaken: meanOf(byBucket('frontline'), 'takenShare'),
    fighterDge: meanOf(byBucket('fighter'), 'damageGoldEfficiency'),
    fighterTaken: meanOf(byBucket('fighter'), 'takenShare')
  }
}

function compositeScore(
  agg: ReturnType<typeof aggregateRecords>,
  pools: Record<string, Pool | null>,
  winMean: number,
  winStd: number
): number | null {
  const terms: { z: number; weight: number }[] = []

  if (agg.gameCount > 0 && winStd > 1e-9) {
    terms.push({ z: (agg.winRate - winMean) / winStd, weight: METRIC_WEIGHTS.winRate })
  }

  const kdaPool = pools.kda
  if (agg.gameCount > 0 && kdaPool) {
    terms.push({ z: zOf(agg.kda, kdaPool), weight: METRIC_WEIGHTS.kda })
  }

  const carryDgePool = pools.carryDge
  if (agg.carryDge !== null && carryDgePool) {
    terms.push({ z: zOf(agg.carryDge, carryDgePool), weight: METRIC_WEIGHTS.carryDge })
  }

  const frontlineTakenPool = pools.frontlineTaken
  if (agg.frontlineTaken !== null && frontlineTakenPool) {
    terms.push({
      z: zOf(agg.frontlineTaken, frontlineTakenPool),
      weight: METRIC_WEIGHTS.frontlineTaken
    })
  }

  const fighterDgePool = pools.fighterDge
  if (agg.fighterDge !== null && fighterDgePool) {
    terms.push({ z: zOf(agg.fighterDge, fighterDgePool), weight: METRIC_WEIGHTS.fighterDge })
  }

  const fighterTakenPool = pools.fighterTaken
  if (agg.fighterTaken !== null && fighterTakenPool) {
    terms.push({ z: zOf(agg.fighterTaken, fighterTakenPool), weight: METRIC_WEIGHTS.fighterTaken })
  }

  const weightSum = terms.reduce((sum, term) => sum + term.weight, 0)
  if (!terms.length || weightSum <= 0) {
    return null
  }

  return terms.reduce((sum, term) => sum + term.weight * term.z, 0) / weightSum
}

export interface HorseGradeReport {
  /** 参与统计的去重对局数 */
  gameCount: number
  /** 参与统计的参与者数量（马种分布的总体） */
  participantCount: number
  population: {
    winRate: number
    kdaMean: number
    carryDgeMean: number
    frontlineTakenMean: number
    fighterDgeMean: number
    fighterTakenMean: number
    compositeMean: number
    compositeStd: number
  }
  /** 正态分布分层后的分数区间 */
  bands: { head: number; upper: number; lower: number; ox: number }
  players: (HorseGradeResult & { puuid: string; name: string; displayName: string })[]
}

export interface HorseGradeResult {
  grade: HorseGrade
  /** 综合评分（相对总体的 z 分数） */
  score: number
  /** 正态模型估计的分位（0-100，越高越强） */
  percentile: number
  metrics: {
    winRate: number
    kda: number
    carryDge: number | null
    frontlineTaken: number | null
    fighterDge: number | null
    fighterTaken: number | null
    gameCount: number
  }
}

/**
 * 构建马种评价报告。
 *
 * @param players 参与评价的玩家（勾选目标）
 * @param games 这些玩家的全部对局（跨玩家按 gameId 去重后为总体）
 * @param champions 英雄定位表
 */
export function buildHorseGradeReport(args: {
  players: HorseGradePlayerInput[]
  games: AramMayhemGameJson[]
  champions: Record<number, HorseGradeChampionInfo>
}): HorseGradeReport | null {
  const { players, games, champions } = args

  // 1. 跨玩家去重对局
  const gameMap = new Map<number, AramMayhemGameJson>()
  for (const game of games) {
    if (game.endOfGameResult !== 'GameComplete' || game.queueId !== 2400) continue
    if (!gameMap.has(game.gameId)) {
      gameMap.set(game.gameId, game)
    }
  }

  const dedupedGames: AramMayhemGameJson[] = [...gameMap.values()]
  if (!dedupedGames.length) {
    return null
  }

  // 2. 总体：全部对局参与者的指标记录
  const records: ParticipantRecord[] = []
  for (const game of dedupedGames) {
    records.push(...collectRecords(game, champions))
  }
  if (!records.length) {
    return null
  }

  // 3. 总体指标池（忽略辅助位数据）
  const pools = {
    kda: makePool(records.filter((r) => r.bucket !== 'support').map((r) => r.kda)),
    carryDge: makePool(
      records.filter((r) => r.bucket === 'carry').map((r) => r.damageGoldEfficiency)
    ),
    frontlineTaken: makePool(
      records.filter((r) => r.bucket === 'frontline').map((r) => r.takenShare)
    ),
    fighterDge: makePool(
      records.filter((r) => r.bucket === 'fighter').map((r) => r.damageGoldEfficiency)
    ),
    fighterTaken: makePool(records.filter((r) => r.bucket === 'fighter').map((r) => r.takenShare))
  }

  const winRatePoolMean = records.reduce((sum, r) => sum + (r.win ? 1 : 0), 0) / records.length
  const winStd = Math.sqrt(Math.max(1e-9, winRatePoolMean * (1 - winRatePoolMean)))

  // 4. 总体中每名参与者的综合评分（正态分布）
  const byPuuid = new Map<string, ParticipantRecord[]>()
  for (const record of records) {
    if (!record.puuid) continue
    const list = byPuuid.get(record.puuid) ?? []
    list.push(record)
    byPuuid.set(record.puuid, list)
  }

  const composites: number[] = []
  for (const participantRecords of byPuuid.values()) {
    const agg = aggregateRecords(participantRecords)
    const composite = compositeScore(agg, pools, winRatePoolMean, winStd)
    if (composite !== null) {
      composites.push(composite)
    }
  }

  if (composites.length < 10) {
    return null
  }

  const compositeMean = composites.reduce((a, b) => a + b, 0) / composites.length
  const compositeStd = Math.sqrt(
    composites.reduce((a, b) => a + (b - compositeMean) ** 2, 0) / composites.length
  )

  if (compositeStd <= 1e-9) {
    return null
  }

  // 5. 正态分布分层后的分数区间
  const bands = {
    head: round(compositeMean + 2 * compositeStd, 3),
    upper: round(compositeMean + compositeStd, 3),
    lower: round(compositeMean - compositeStd, 3),
    ox: round(compositeMean - 2 * compositeStd, 3)
  }

  // 6. 逐玩家评分与马种
  const results: (HorseGradeResult & {
    puuid: string
    name: string
    displayName: string
  })[] = []

  for (const player of players) {
    const participantRecords = byPuuid.get(player.puuid)

    if (!participantRecords?.length) {
      results.push({
        puuid: player.puuid,
        name: player.name,
        displayName: player.name,
        grade: '中等马',
        score: compositeMean,
        percentile: 50,
        metrics: {
          winRate: 0,
          kda: 0,
          carryDge: null,
          frontlineTaken: null,
          fighterDge: null,
          fighterTaken: null,
          gameCount: 0
        }
      })
      continue
    }

    const agg = aggregateRecords(participantRecords)
    const composite = compositeScore(agg, pools, winRatePoolMean, winStd)

    if (composite === null) {
      results.push({
        puuid: player.puuid,
        name: player.name,
        displayName: player.name,
        grade: '中等马',
        score: compositeMean,
        percentile: 50,
        metrics: {
          winRate: round(agg.winRate, 3),
          kda: round(agg.kda, 2),
          carryDge: null,
          frontlineTaken: null,
          fighterDge: null,
          fighterTaken: null,
          gameCount: agg.gameCount
        }
      })
      continue
    }

    let grade: HorseGrade
    if (composite >= bands.head) {
      grade = '马头'
    } else if (composite >= bands.upper) {
      grade = '上等马'
    } else if (composite > bands.lower) {
      grade = '中等马'
    } else if (composite > bands.ox) {
      grade = '下等马'
    } else {
      grade = '牛马'
    }

    results.push({
      puuid: player.puuid,
      name: player.name,
      displayName: player.name,
      grade,
      score: round(composite, 2),
      percentile: gradeToPercentile(composite),
      metrics: {
        winRate: round(agg.winRate, 3),
        kda: round(agg.kda, 2),
        carryDge: agg.carryDge !== null ? round(agg.carryDge, 2) : null,
        frontlineTaken: agg.frontlineTaken !== null ? round(agg.frontlineTaken, 3) : null,
        fighterDge: agg.fighterDge !== null ? round(agg.fighterDge, 2) : null,
        fighterTaken: agg.fighterTaken !== null ? round(agg.fighterTaken, 3) : null,
        gameCount: agg.gameCount
      }
    })
  }

  return {
    gameCount: dedupedGames.length,
    participantCount: records.length,
    population: {
      winRate: round(winRatePoolMean, 3),
      kdaMean: round(pools.kda?.mean ?? 0, 2),
      carryDgeMean: round(pools.carryDge?.mean ?? 0, 2),
      frontlineTakenMean: round(pools.frontlineTaken?.mean ?? 0, 3),
      fighterDgeMean: round(pools.fighterDge?.mean ?? 0, 2),
      fighterTakenMean: round(pools.fighterTaken?.mean ?? 0, 3),
      compositeMean: round(compositeMean, 3),
      compositeStd: round(compositeStd, 3)
    },
    bands,
    players: results
  }
}
