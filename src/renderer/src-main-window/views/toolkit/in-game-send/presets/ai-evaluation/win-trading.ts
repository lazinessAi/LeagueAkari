/**
 * 刷负嫌疑四门控算法（确定性，概率不由 AI 判断）。
 *
 * 用户画像（2026-09-13）：
 *  G1 样本量：最近 10-100 场（<10 不统计，重开局除外），数据越多基础可信度越高
 *  G2 组队低胜区间：按时间存在连续区间，区间内 4/5 黑组队且胜率 <50%（越低越可信）；
 *    多区间可合并（间隔 ≤3 场），区间越长、占总场数比例越高越可信
 *  G3 主动投降：区间内败局主动投降率 ≥70% 满分（50% 低数据放宽，<50% 不通过）
 *  G4 推塔持平/领先：区间内投降败局中我方推塔 ≥ 对方的比例 ≥90% 满分（放宽下限 70%，<70% 不通过）——极关键指标
 *
 * 四门控任一不通过 → 概率直接归零；全部通过时采用几何加权合成（短板惩罚），
 * 仅 1-2 项高、其余平庸时合成结果不会高。
 *
 * 加分项（非必须，各 +2-8pp，封顶 100）：
 *  B1 场均时长接近 8 分钟（投降局权重高）
 *  B2 守护者出门装且无血瓶（胜负局均计入）
 *  B3 投降败局中我方人头多于对方
 */

export interface WinTradingGameInput {
  gameCreation: number
  /** 场均时长（分钟） */
  durationMin: number
  win: boolean
  /** 主动投降（不含重开局） */
  surrendered: boolean
  /** 重开局（不计入统计） */
  isRemake: boolean
  ownTowerKills: number
  enemyTowerKills: number
  teamKills: number
  enemyKills: number
  /** 出门装为守护者系列 */
  guardianStart: boolean
  /** 出门装携带血瓶类装备 */
  hasPotion: boolean
  teammates: string[]
}

export interface WinTradingInterval {
  /** 时序索引（0 = 最早） */
  startIndex: number
  endIndex: number
  games: number
  wins: number
  /** 区间胜率 */
  winRate: number
  /** 区间内"≥3 人组队"场占比 */
  premadeShare: number
  /** 区间内"≥4 人组队"场占比 */
  stack4Share: number
  /** 区间内败局投降率 */
  surrenderRatio: number
  /** 区间内投降败局中推塔持平/领先占比 */
  towerLeadRatio: number
  /** 区间内投降败局中我方人头领先占比 */
  killLeadRatio: number
}

export interface WinTradingGate {
  id: 'sample' | 'interval' | 'surrender' | 'towers'
  passed: boolean
  confidence: number
  details: Record<string, unknown>
}

export interface WinTradingResult {
  /** 0-100，整数 */
  probability: number
  insufficient: boolean
  passed: boolean
  gates: WinTradingGate[]
  intervals: WinTradingInterval[]
  bonuses: {
    durationScore: number
    guardianScore: number
    killLeadScore: number
    bonusPoints: number
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** 常驻队友判定：在总场数中出现 ≥30% */
const CORE_TEAMMATE_PRESENCE = 0.3
/** 区间合并容忍间隔 */
const INTERVAL_MERGE_GAP = 3
/** 区间最短长度 */
const INTERVAL_MIN_LENGTH = 5

export function computeWinTradingSuspicion(inputGames: WinTradingGameInput[]): WinTradingResult {
  // G1: 排除重开局，样本量门槛
  const games = inputGames
    .filter((g) => !g.isRemake)
    .slice()
    .sort((a, b) => a.gameCreation - b.gameCreation)
  const n = games.length

  const insufficientResult: WinTradingResult = {
    probability: 0,
    insufficient: true,
    passed: false,
    gates: [],
    intervals: [],
    bonuses: { durationScore: 0, guardianScore: 0, killLeadScore: 0, bonusPoints: 0 }
  }

  if (n < 10) {
    return insufficientResult
  }

  const G1 = Math.min(1, n / 100)

  // 常驻队友（出现 ≥30% 总场数）
  const teammatePresence = new Map<string, number>()
  for (const game of games) {
    for (const mate of game.teammates) {
      teammatePresence.set(mate, (teammatePresence.get(mate) ?? 0) + 1)
    }
  }
  const coreTeammates = new Set(
    [...teammatePresence.entries()]
      .filter(([, count]) => count / n >= CORE_TEAMMATE_PRESENCE)
      .map(([mate]) => mate)
  )

  // 每局组队人数：自己 + 常驻队友在场数
  const groupSize = games.map(
    (game) => 1 + game.teammates.filter((mate) => coreTeammates.has(mate)).length
  )

  // G2: 区间检测——连续的组队局（groupSize ≥ 3）且段胜率 < 50%
  const isGroupGame = groupSize.map((size) => size >= 3)
  const rawSegments: { start: number; end: number }[] = []
  let cursor = 0
  while (cursor < n) {
    if (!isGroupGame[cursor]) {
      cursor++
      continue
    }
    let end = cursor
    while (end + 1 < n && isGroupGame[end + 1]) {
      end++
    }
    rawSegments.push({ start: cursor, end })
    cursor = end + 1
  }

  // 合并间隔 ≤3 的相邻段
  const mergedSegments: { start: number; end: number }[] = []
  for (const seg of rawSegments) {
    const last = mergedSegments[mergedSegments.length - 1]
    if (last && seg.start - last.end - 1 <= INTERVAL_MERGE_GAP) {
      last.end = seg.end
    } else {
      mergedSegments.push({ ...seg })
    }
  }

  // 段统计与有效性过滤
  const intervalStats = mergedSegments.map((seg) => {
    const members = games.slice(seg.start, seg.end + 1)
    const gamesCount = members.length
    const wins = members.filter((g) => g.win).length
    const winRate = wins / gamesCount
    const premadeGames = members.filter((_, idx) => groupSize[seg.start + idx] >= 3).length
    const stack4Games = members.filter((_, idx) => groupSize[seg.start + idx] >= 4).length
    const losses = members.filter((g) => !g.win)
    const surrenderedLosses = losses.filter((g) => g.surrendered)
    const surrenderRatio = losses.length ? surrenderedLosses.length / losses.length : 0
    const towerLeadRatio = surrenderedLosses.length
      ? surrenderedLosses.filter((g) => g.ownTowerKills >= g.enemyTowerKills).length /
        surrenderedLosses.length
      : 0
    const killLeadRatio = surrenderedLosses.length
      ? surrenderedLosses.filter((g) => g.teamKills >= g.enemyKills).length /
        surrenderedLosses.length
      : 0
    const avgSurrenderDuration = surrenderedLosses.length
      ? surrenderedLosses.reduce((sum, g) => sum + g.durationMin, 0) / surrenderedLosses.length
      : 0

    return {
      ...seg,
      gamesCount,
      wins,
      winRate,
      premadeShare: premadeGames / gamesCount,
      stack4Share: stack4Games / gamesCount,
      losses: losses.length,
      surrenderedLosses: surrenderedLosses.length,
      surrenderRatio,
      towerLeadRatio,
      killLeadRatio,
      avgSurrenderDuration
    }
  })

  // 有效区间：段长 ≥5 且 段胜率 <50%
  const validIntervals = intervalStats.filter(
    (seg) => seg.gamesCount >= INTERVAL_MIN_LENGTH && seg.winRate < 0.5
  )

  // 区间内局索引集合（供 G3/G4 统计；多区间取并集）
  const intervalIndexSet = new Set<number>()
  for (const seg of validIntervals) {
    for (let i = seg.start; i <= seg.end; i++) {
      intervalIndexSet.add(i)
    }
  }
  const intervalGames = games.filter((_, idx) => intervalIndexSet.has(idx))

  // 聚合所有有效区间的门控指标
  const totalIntervalGames = intervalGames.length
  const intervalWins = intervalGames.filter((g) => g.win).length
  const intervalLosses = intervalGames.filter((g) => !g.win)
  const intervalSurrenderedLosses = intervalLosses.filter((g) => g.surrendered)
  const surrenderRatio = intervalLosses.length
    ? intervalSurrenderedLosses.length / intervalLosses.length
    : 0
  const towerLeadRatio = intervalSurrenderedLosses.length
    ? intervalSurrenderedLosses.filter((g) => g.ownTowerKills >= g.enemyTowerKills).length /
      intervalSurrenderedLosses.length
    : 0
  const killLeadRatio = intervalSurrenderedLosses.length
    ? intervalSurrenderedLosses.filter((g) => g.teamKills >= g.enemyKills).length /
      intervalSurrenderedLosses.length
    : 0
  const intervalWinRate = intervalGames.length ? intervalWins / intervalGames.length : 1
  const premadeShare = intervalGames.length
    ? intervalGames.filter((g) => {
        const idx = games.indexOf(g)
        return idx !== -1 && groupSize[idx] >= 3
      }).length / intervalGames.length
    : 0
  const stack4Share = intervalGames.length
    ? intervalGames.filter((g) => {
        const idx = games.indexOf(g)
        return idx !== -1 && groupSize[idx] >= 4
      }).length / intervalGames.length
    : 0
  const intervalLength = intervalGames.length

  // 门控置信度
  // G2: 4/5 黑 + 低胜率 + 区间规模
  const premadeOk = premadeShare >= 0.5 && totalIntervalGames >= INTERVAL_MIN_LENGTH
  const wrScore = clamp01((0.5 - intervalWinRate) / 0.5)
  const lenScore = Math.min(1, intervalLength / 25)
  const shareScore = Math.min(1, intervalLength / n / 0.3)
  const stackScore = clamp01((stack4Share - 0.3) / 0.7)
  const C2 = premadeOk
    ? clamp01((premadeShare - 0.5) / 0.5) *
      (0.45 + 0.1 * wrScore + 0.15 * lenScore + 0.1 * shareScore + 0.15 * stackScore)
    : 0

  // G3: 主动投降（≥70% 满分置信，≥50% 低数据放宽，<50% 不通过）
  const surrenderOk = intervalLosses.length >= 2 && surrenderRatio >= 0.5
  const C3 = surrenderOk ? (surrenderRatio >= 0.9 ? 1 : surrenderRatio >= 0.7 ? 0.85 : 0.5) : 0

  // G4: 投降败局推塔持平/领先（极关键，<70% 不通过）
  const towerOk = intervalSurrenderedLosses.length >= 2 && towerLeadRatio >= 0.7
  const C4 = towerOk ? clamp01((towerLeadRatio - 0.7) / 0.25) : 0

  const gates: WinTradingGate[] = [
    {
      id: 'sample',
      passed: true,
      confidence: G1,
      details: { sampleSize: n, excludedRemakes: inputGames.length - n }
    },
    {
      id: 'interval',
      passed: premadeOk,
      confidence: C2,
      details: {
        intervals: validIntervals.map((seg) => ({
          start: seg.start,
          end: seg.end,
          games: seg.gamesCount,
          winRate: seg.winRate,
          premadeShare: seg.premadeShare,
          stack4Share: seg.stack4Share
        })),
        intervalGames: totalIntervalGames,
        intervalShare: n ? round(intervalLength / n, 3) : 0,
        intervalWinRate: round(intervalWinRate, 3),
        premadeShare: round(premadeShare, 3),
        stack4Share: round(stack4Share, 3)
      }
    },
    {
      id: 'surrender',
      passed: surrenderOk,
      confidence: C3,
      details: {
        losses: intervalLosses.length,
        surrenderedLosses: intervalSurrenderedLosses.length,
        surrenderRatio: round(surrenderRatio, 3)
      }
    },
    {
      id: 'towers',
      passed: towerOk,
      confidence: C4,
      details: {
        surrenderedLosses: intervalSurrenderedLosses.length,
        towerLeadRatio: round(towerLeadRatio, 3)
      }
    }
  ]

  // 四门控任一不通过 → 概率清零
  const allPassed = gates.every((gate) => gate.passed)

  // 加性合成：四门控全过为基础 55 分，各门控置信度加权累加（满值 45）；
  // 任一门控置信度 <0.7（即 1-2 项高、其余平庸）→ 上限 75，不能视为高嫌疑
  let probability = 0
  if (allPassed) {
    const minConf = Math.min(G1, C2, C3, C4)
    probability = round(55 + G1 * 6 + C2 * 16 + C3 * 11 + C4 * 12, 0)
    if (minConf < 0.7) {
      probability = Math.min(probability, 75)
    }

    // 加分项
    const surrenderedDurations = intervalSurrenderedLosses.map((g) => g.durationMin)
    const durationScore = surrenderedDurations.length
      ? clamp01((14 - mean(surrenderedDurations)) / 6)
      : 0
    const allDurScore = clamp01((14 - mean(aggDuration(games))) / 6)
    const guardianGames = games.filter((g) => g.guardianStart && !g.hasPotion).length
    const guardianScore = clamp01(guardianGames / Math.max(10, n * 0.3))
    const killLeadScore = clamp01((killLeadRatio - 0.5) / 0.5)

    const bonusPoints = round(
      8 * (0.7 * durationScore + 0.3 * allDurScore) + 6 * guardianScore + 5 * killLeadScore,
      1
    )
    probability = Math.min(99, probability + bonusPoints)

    return {
      probability,
      insufficient: false,
      passed: true,
      gates,
      intervals: validIntervals.map((seg) => ({
        startIndex: seg.start,
        endIndex: seg.end,
        games: seg.gamesCount,
        wins: seg.wins,
        winRate: round(seg.winRate, 3),
        premadeShare: round(seg.premadeShare, 3),
        stack4Share: round(seg.stack4Share, 3),
        surrenderRatio: round(seg.surrenderRatio, 3),
        towerLeadRatio: round(seg.towerLeadRatio, 3),
        killLeadRatio: round(seg.killLeadRatio, 3)
      })),
      bonuses: {
        durationScore: round(durationScore, 2),
        guardianScore: round(guardianScore, 2),
        killLeadScore: round(killLeadScore, 2),
        bonusPoints
      }
    }
  }

  return {
    probability: 0,
    insufficient: false,
    passed: false,
    gates,
    intervals: validIntervals.map((seg) => ({
      startIndex: seg.start,
      endIndex: seg.end,
      games: seg.gamesCount,
      wins: seg.wins,
      winRate: round(seg.winRate, 3),
      premadeShare: round(seg.premadeShare, 3),
      stack4Share: round(seg.stack4Share, 3),
      surrenderRatio: round(seg.surrenderRatio, 3),
      towerLeadRatio: round(seg.towerLeadRatio, 3),
      killLeadRatio: round(seg.killLeadRatio, 3)
    })),
    bonuses: { durationScore: 0, guardianScore: 0, killLeadScore: 0, bonusPoints: 0 }
  }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function aggDuration(games: { durationMin: number }[]): number[] {
  return games.map((g) => g.durationMin)
}

function round(v: number, digits = 1): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
