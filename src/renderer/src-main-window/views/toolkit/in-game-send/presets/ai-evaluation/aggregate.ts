/**
 * 海克斯大乱斗聚合分析（纯函数）。
 *
 * 输入玩家近 N 场对局的 SGP SUMMARY json 与英雄/强化静态对照表，
 * 输出直接可拼进提示词的聚合报告。口径与调试期脚本一致：
 * 伤转率 = 伤害占比 ÷ 经济占比（队内归一化，基准 1.0）。
 */

export interface AramMayhemGameJson {
  gameId: number
  gameCreation: number
  gameDuration: number
  queueId: number
  endOfGameResult: string
  participants: AramMayhemGameParticipant[]
  teams?: AramMayhemGameTeam[]
}

interface AramMayhemGameParticipant {
  participantId: number
  puuid?: string
  teamId: number
  win?: unknown
  /** LCU 详情格式的嵌套 stats；SGP 为平铺字段 */
  stats?: Record<string, any>
  [key: string]: any
}

interface AramMayhemGameTeam {
  teamId: number
  win?: unknown
  /** LCU 字段 */
  towerKills?: number
  objectives?: { tower?: { kills?: number } }
}

export interface AramMayhemChampionInfo {
  name?: string
  alias?: string
  roles?: string[]
}

export interface AramMayhemKiwiAugmentInfo {
  name_cn?: string
  level?: string
}

export type AiEvaluationSuspicionLevel = 'none' | 'low' | 'medium' | 'high'

export interface AramMayhemReport {
  player: string
  sampleSize: number
  dateRange: [string?, string?]
  overall: Record<string, any>
  winLossSplit: Record<string, any>
  consistency: Record<string, any>
  mainPosition: { bucket: string; games: number }
  conditional: Record<string, Record<string, any>>
  championPool: { distinct: number; table: Record<string, any>[] }
  augmentStats: { avgPerGame: number; table: Record<string, any>[] }
  winTrading: Record<string, any>
  smurf: Record<string, any>
}

const BUCKETS = ['carry', 'fighter', 'frontline', 'support', 'other'] as const

function round(v: number, digits = 1): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)))
}

function wilson95(wins: number, total: number): [number, number] {
  if (!total) return [0, 0]
  const p = wins / total
  const z = 1.96
  const denom = 1 + (z * z) / total
  const center = (p + (z * z) / (2 * total)) / denom
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom
  return [round(center - margin, 3), round(center + margin, 3)]
}

/** SGP 参与者字段平铺，LCU 详情嵌套在 stats 下，这里做双格式兼容 */
function stat(participant: AramMayhemGameParticipant, key: string): any {
  return participant.stats ? participant.stats[key] : participant[key]
}

function isWin(participant: AramMayhemGameParticipant, game: AramMayhemGameJson): boolean {
  if (participant.win !== undefined && participant.win !== null) {
    return participant.win === true || participant.win === 'Win'
  }

  const teamEntry = game.teams?.find((t) => t.teamId === participant.teamId)
  return teamEntry ? teamEntry.win === 'Win' || teamEntry.win === true : false
}

function teamTowerKills(game: AramMayhemGameJson, teamId: number): number {
  const entry = game.teams?.find((t) => t.teamId === teamId)
  return entry?.towerKills ?? entry?.objectives?.tower?.kills ?? 0
}

/** 定位桶的中文标签 */
export const ARAM_MAYHEM_BUCKET_LABELS: Record<string, string> = {
  carry: '输出位',
  fighter: '战士',
  frontline: '前排',
  support: '辅助',
  other: '其他'
}

/**
 * 用模板从聚合报告直接生成评价文字（不经过 AI）。
 * 嫌疑限定语（刷负/玩小号）由确定性概率计算，高于展示阈值时追加在句中。
 */
export function buildEvaluationText(report: AramMayhemReport): string {
  const n = report.sampleSize

  if (n < 10) {
    return `样本不足（${n} 场），数据过少无法给出可靠评价`
  }

  const overall = report.overall
  const clauses: string[] = []
  const suspicionClause = buildSuspicionClause(report)
  if (suspicionClause) {
    clauses.push(suspicionClause)
  }

  clauses.push(
    `主玩${ARAM_MAYHEM_BUCKET_LABELS[report.mainPosition.bucket] ?? report.mainPosition.bucket}（${report.mainPosition.games}场、胜率${Math.round((report.conditional[report.mainPosition.bucket]?.winRate ?? 0) * 100)}%、伤转率${Math.round((report.conditional[report.mainPosition.bucket]?.avgDamageGoldEfficiency ?? 0) * 100)}%、经济${report.conditional[report.mainPosition.bucket]?.avgGoldPerMin ?? 0}/分）`
  )

  const fighter = report.conditional.fighter
  if (fighter && fighter.games >= 3) {
    clauses.push(`玩战士时伤转率${Math.round(fighter.avgDamageGoldEfficiency * 100)}%`)
  }

  const frontline = report.conditional.frontline
  if (frontline && frontline.games >= 3) {
    clauses.push(`玩前排时承伤占比${Math.round(frontline.avgTakenShare * 100)}%`)
  }

  return `近${n}场胜率${Math.round(overall.winRate * 100)}%（${clauses.join('，')}）`
}

/** 嫌疑限定语的展示阈值：低于此概率不展示（低嫌疑不对外） */
export const AI_SUSPICION_DISPLAY_THRESHOLD = 0.5

/**
 * 按确定性概率组装嫌疑限定语（刷负/玩小号），供调用方拼接进 AI 评价句。
 * 低于展示阈值的嫌疑不展示。
 */
export function buildSuspicionClause(report: AramMayhemReport): string {
  const clauses: string[] = []

  const winTradingProbability = report.winTrading?.suspicionProbability ?? 0
  if (winTradingProbability >= AI_SUSPICION_DISPLAY_THRESHOLD) {
    clauses.push(`刷负嫌疑${Math.round(winTradingProbability * 100)}%`)
  }

  const smurfProbability = report.smurf?.suspicionProbability ?? 0
  if (smurfProbability >= AI_SUSPICION_DISPLAY_THRESHOLD) {
    clauses.push(`疑似玩小号（${Math.round(smurfProbability * 100)}%）`)
  }

  return clauses.join('、')
}

export function buildAramMayhemReport(args: {
  playerName: string
  playerPuuid: string
  playerLevel?: number | null
  games: AramMayhemGameJson[]
  champions: Record<number, AramMayhemChampionInfo>
  kiwiAugments: Record<number, AramMayhemKiwiAugmentInfo>
  /** 物品 id -> 名称（守护者出门装识别用），不可得时该信号不计分 */
  itemNames?: Record<number, string>
}): AramMayhemReport | null {
  const { playerName, playerPuuid, playerLevel, games, champions, kiwiAugments, itemNames } = args

  const perGame = games.map((game) => {
    const me =
      game.participants.find((p) => p.puuid === playerPuuid) ??
      (() => {
        // 兼容 LCU 详情格式（puuid 在 participantIdentities 中）
        const identities = (game as any).participantIdentities as
          { participantId: number; player?: { puuid: string } }[] | undefined
        const identity = identities?.find((x) => x.player?.puuid === playerPuuid)
        return identity
          ? game.participants.find((p) => p.participantId === identity.participantId)
          : undefined
      })()

    if (!me) return null

    const durMin = game.gameDuration / 60
    const allies = game.participants.filter((p) => p.teamId === me.teamId)
    const enemies = game.participants.filter((p) => p.teamId !== me.teamId)
    const teamKills = allies.reduce((sum, p) => sum + (stat(p, 'kills') ?? 0), 0)
    const teamDmg = allies.reduce(
      (sum, p) => sum + (stat(p, 'totalDamageDealtToChampions') ?? 0),
      0
    )
    const teamTaken = allies.reduce((sum, p) => sum + (stat(p, 'totalDamageTaken') ?? 0), 0)
    const teamHeal = allies.reduce((sum, p) => sum + (stat(p, 'totalHeal') ?? 0), 0)
    const teamGold = allies.reduce((sum, p) => sum + (stat(p, 'goldEarned') ?? 0), 0)
    const enemyKills = enemies.reduce((sum, p) => sum + (stat(p, 'kills') ?? 0), 0)
    const enemyGold = enemies.reduce((sum, p) => sum + (stat(p, 'goldEarned') ?? 0), 0)
    const myDmg = stat(me, 'totalDamageDealtToChampions') ?? 0
    const myGold = stat(me, 'goldEarned') ?? 0

    const dmgRankInTeam =
      [...allies]
        .sort(
          (a, b) =>
            (stat(b, 'totalDamageDealtToChampions') ?? 0) -
            (stat(a, 'totalDamageDealtToChampions') ?? 0)
        )
        .findIndex((p) => p.participantId === me.participantId) + 1

    const championInfo = champions[me.championId] ?? {}
    const roles = championInfo.roles ?? []
    // 战士：战士+坦克双定位（输出承伤兼备，以输出为主）；前排：纯坦克定位（基本仅有承伤）
    const bucket =
      roles.includes('tank') && roles.includes('fighter')
        ? 'fighter'
        : roles.includes('tank')
          ? 'frontline'
          : roles.includes('support')
            ? 'support'
            : roles.includes('marksman') ||
                roles.includes('mage') ||
                roles.includes('assassin') ||
                roles.includes('fighter')
              ? 'carry'
              : 'other'

    const augmentIds = [1, 2, 3, 4, 5, 6]
      .map((i) => stat(me, `playerAugment${i}`))
      .filter((id) => id && kiwiAugments[id])

    const item0 = stat(me, 'item0')
    const item0Name = item0 ? itemNames?.[item0] : undefined
    const guardianStart = !!item0Name && item0Name.startsWith('守护者')
    const FLASH_SPELL_ID = 4
    const flashOnD = stat(me, 'spell1Id') === FLASH_SPELL_ID
    const flashOnF = stat(me, 'spell2Id') === FLASH_SPELL_ID

    const surrendered = !!(stat(me, 'gameEndedInSurrender') || stat(me, 'gameEndedInIGNBSurrender'))
    const teamGoldAll = teamGold + enemyGold
    const teamKillsAll = teamKills + enemyKills

    return {
      gameId: game.gameId,
      date: new Date(game.gameCreation).toISOString().slice(0, 10),
      durationMin: round(durMin),
      championId: me.championId,
      champion: championInfo.alias ?? String(me.championId),
      championName: championInfo.name ?? String(me.championId),
      roles,
      bucket,
      win: isWin(me, game),
      augmentIds,
      kills: stat(me, 'kills') ?? 0,
      deaths: stat(me, 'deaths') ?? 0,
      assists: stat(me, 'assists') ?? 0,
      kda: round(
        ((stat(me, 'kills') ?? 0) + (stat(me, 'assists') ?? 0)) /
          Math.max(1, stat(me, 'deaths') ?? 0)
      ),
      killParticipation:
        teamKills > 0
          ? round(((stat(me, 'kills') ?? 0) + (stat(me, 'assists') ?? 0)) / teamKills, 3)
          : 0,
      dpm: round(myDmg / durMin),
      damageShare: teamDmg > 0 ? round(myDmg / teamDmg, 3) : 0,
      damageRankInTeam: dmgRankInTeam,
      damageGoldEfficiency:
        teamDmg > 0 && myGold > 0
          ? round(myDmg / teamDmg / (myGold / Math.max(1, teamGold)), 2)
          : 0,
      goldPerMin: round(myGold / durMin),
      takenPerMin: round((stat(me, 'totalDamageTaken') ?? 0) / durMin),
      takenShare: teamTaken > 0 ? round((stat(me, 'totalDamageTaken') ?? 0) / teamTaken, 3) : 0,
      selfMitigatedPerMin: round((stat(me, 'damageSelfMitigated') ?? 0) / durMin),
      healPerMin: round((stat(me, 'totalHeal') ?? 0) / durMin),
      healShare: teamHeal > 0 ? round((stat(me, 'totalHeal') ?? 0) / teamHeal, 3) : 0,
      ccPerMin: round((stat(me, 'timeCCingOthers') ?? 0) / durMin),
      deathsPerMin: round((stat(me, 'deaths') ?? 0) / durMin, 2),
      multiKills:
        (stat(me, 'doubleKills') ?? 0) +
        (stat(me, 'tripleKills') ?? 0) +
        (stat(me, 'quadraKills') ?? 0) +
        (stat(me, 'pentaKills') ?? 0),
      firstBlood: !!(stat(me, 'firstBloodKill') || stat(me, 'firstBloodAssist')),
      surrendered,
      goldShareAll: teamGoldAll > 0 ? round(teamGold / teamGoldAll, 3) : 0.5,
      killShareAll: teamKillsAll > 0 ? round(teamKills / teamKillsAll, 3) : 0.5,
      towerLead:
        teamTowerKills(game, me.teamId) - teamTowerKills(game, me.teamId === 100 ? 200 : 100),
      ownTowerKills: teamTowerKills(game, me.teamId),
      guardianStart,
      flashOnD,
      flashOnF,
      alliesChampionIds: allies.map((p) => p.championId),
      teammates: allies
        .filter((p) => p.participantId !== me.participantId)
        .map((p) => p.puuid ?? String(p.participantId)),
      level: stat(me, 'champLevel') ?? 0
    }
  })

  const entries = perGame.filter((g): g is NonNullable<typeof g> => g !== null)
  if (!entries.length) {
    return null
  }

  const n = entries.length
  const wins = entries.filter((g) => g.win).length
  const [ciLow, ciHigh] = wilson95(wins, n)
  const agg = (key: string) => entries.map((g) => g[key] as number)
  const winsGames = entries.filter((g) => g.win)
  const losses = entries.filter((g) => !g.win)
  const surrenderedLosses = losses.filter((g) => g.surrendered)
  const dmgShares = agg('damageShare')
  const sortedShares = [...dmgShares].sort((a, b) => a - b)
  const bottomQuartile = sortedShares.slice(0, Math.floor(n / 4))

  const byChampion = new Map<
    string,
    {
      champion: string
      championName: string
      roles: string[]
      games: number
      wins: number
      kills: number
      deaths: number
      assists: number
      dmgShare: number
      dpm: number
    }
  >()
  for (const g of entries) {
    const entry = byChampion.get(g.champion) ?? {
      champion: g.champion,
      championName: g.championName,
      roles: g.roles,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      dmgShare: 0,
      dpm: 0
    }
    entry.games++
    entry.wins += g.win ? 1 : 0
    entry.kills += g.kills
    entry.deaths += g.deaths
    entry.assists += g.assists
    entry.dmgShare += g.damageShare
    entry.dpm += g.dpm
    byChampion.set(g.champion, entry)
  }
  const championTable = [...byChampion.values()]
    .map((e) => ({
      champion: e.champion,
      championName: e.championName,
      roles: e.roles,
      games: e.games,
      wins: e.wins,
      winRate: round(e.wins / e.games, 2),
      avgKda: round((e.kills + e.assists) / Math.max(1, e.deaths)),
      avgDmgShare: round(e.dmgShare / e.games, 3),
      avgDpm: round(e.dpm / e.games)
    }))
    .sort((a, b) => b.games - a.games)

  const byAugment = new Map<string, { name: string; level: string; games: number; wins: number }>()
  let augmentSlots = 0
  for (const g of entries) {
    for (const id of g.augmentIds) {
      const info = kiwiAugments[id]
      if (!info) continue
      augmentSlots++
      const name = info.name_cn ?? String(id)
      const entry = byAugment.get(name) ?? {
        name,
        level: (info.level ?? '').replace('k', ''),
        games: 0,
        wins: 0
      }
      entry.games++
      entry.wins += g.win ? 1 : 0
      byAugment.set(name, entry)
    }
  }
  const augmentTable = [...byAugment.values()]
    .map((e) => ({ ...e, winRate: round(e.wins / e.games, 2) }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 15)

  const conditional: AramMayhemReport['conditional'] = {}
  for (const bucket of BUCKETS) {
    const bucketGames = entries.filter((g) => g.bucket === bucket)
    if (!bucketGames.length) continue
    conditional[bucket] = {
      games: bucketGames.length,
      winRate: round(mean(bucketGames.map((g) => (g.win ? 1 : 0))), 2),
      avgDamageGoldEfficiency: round(mean(bucketGames.map((g) => g.damageGoldEfficiency)), 2),
      avgGoldPerMin: round(mean(bucketGames.map((g) => g.goldPerMin))),
      avgTakenPerMin: round(mean(bucketGames.map((g) => g.takenPerMin))),
      avgTakenShare: round(mean(bucketGames.map((g) => g.takenShare ?? 0)), 3),
      avgHealPerMin: round(mean(bucketGames.map((g) => g.healPerMin))),
      avgHealShare: round(mean(bucketGames.map((g) => g.healShare ?? 0)), 3)
    }
  }

  const mainPosition = BUCKETS.map((bucket) => ({
    bucket,
    games: entries.filter((g) => g.bucket === bucket).length
  }))
    .filter((x) => x.games > 0)
    .sort((a, b) => b.games - a.games)[0] ?? { bucket: 'unknown', games: 0 }

  // 刷负三信号
  const advantageSurrenderLosses = surrenderedLosses.filter((g) => g.goldShareAll >= 0.55)
  const advantageSurrenderRate = surrenderedLosses.length
    ? round(advantageSurrenderLosses.length / surrenderedLosses.length, 3)
    : 0
  const towerLeadSurrenderRate = surrenderedLosses.length
    ? round(surrenderedLosses.filter((g) => g.towerLead >= 1).length / surrenderedLosses.length, 3)
    : 0

  const pairCount = new Map<string, number>()
  for (const g of surrenderedLosses) {
    for (let i = 0; i < g.teammates.length; i++) {
      for (let j = i + 1; j < g.teammates.length; j++) {
        const key = [g.teammates[i], g.teammates[j]].sort().join('|')
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1)
      }
    }
  }
  const topPairCount = Math.max(0, ...pairCount.values())
  const premadePairRate = surrenderedLosses.length
    ? round(topPairCount / surrenderedLosses.length, 3)
    : 0

  const overallWinRate = round(wins / n, 3)
  const highWinRate = overallWinRate >= 0.7
  const lowLevelHighWinRate = playerLevel != null && playerLevel < 100 && highWinRate

  // 刷负嫌疑（连续信号，基于已确认的刷负画像：固定车队投降 + 塔领先 + 高投降败局占比）
  // premadePairRate 是主证据但需折扣（好友固定开黑基线远高于 0）；高胜率是反证（降 25pp）
  const surrenderedLossShare = n ? round(surrenderedLosses.length / n, 3) : 0
  let winTradingSuspicionProbability = 0
  if (surrenderedLosses.length >= 2) {
    winTradingSuspicionProbability = round(
      Math.max(
        0,
        Math.min(
          0.95,
          0.2 +
            Math.max(0, premadePairRate - 0.3) * 0.8 +
            Math.max(0, towerLeadSurrenderRate - 0.56) * 0.3 +
            Math.max(0, surrenderedLossShare - 0.86) * 0.3 -
            (overallWinRate >= 0.6 ? 0.25 : 0)
        )
      ),
      2
    )
  }
  const winTradingSuspicionLevel: AiEvaluationSuspicionLevel =
    winTradingSuspicionProbability >= 0.75
      ? 'high'
      : winTradingSuspicionProbability >= 0.5
        ? 'medium'
        : winTradingSuspicionProbability > 0
          ? 'low'
          : 'none'
  // 小号嫌疑（启发式，积分制）
  // S1 成长断层：近段(最近25场) vs 远段(更早25场) 胜率差≥25pp 或 伤转率差≥30pp（两段各≥10场才有效）
  // S2 低等级（分级计分）：<100 计1；≤50 计2；≤30 计3；≤10 计4
  // S3 守护者出门装：item0 名以"守护者"开头的场次 ≥3
  // S4 闪现异位：D 闪与 F 闪同时存在
  const recentGames = entries.slice(0, 25)
  const remoteGames = entries.slice(25, 50)
  const segmentsValid = recentGames.length >= 10 && remoteGames.length >= 10
  const recentWR = segmentsValid ? mean(recentGames.map((g) => (g.win ? 1 : 0))) : 0
  const remoteWR = segmentsValid ? mean(remoteGames.map((g) => (g.win ? 1 : 0))) : 0
  const winRateGap = segmentsValid ? round((recentWR - remoteWR) * 100, 1) : 0
  const dmgEffGap = segmentsValid
    ? round(
        (mean(recentGames.map((g) => g.damageGoldEfficiency)) -
          mean(remoteGames.map((g) => g.damageGoldEfficiency))) *
          100,
        1
      )
    : 0
  const growthCliff = segmentsValid && (recentWR - remoteWR >= 0.25 || dmgEffGap >= 30)

  let levelScore = 0
  if (playerLevel != null) {
    if (playerLevel < 100) levelScore = 1
    if (playerLevel <= 50) levelScore = 2
    if (playerLevel <= 30) levelScore = 3
    if (playerLevel <= 10) levelScore = 4
  }

  const guardianStartCount = entries.filter((g) => g.guardianStart).length
  const flashSwap = entries.some((g) => g.flashOnD) && entries.some((g) => g.flashOnF)

  // 小号嫌疑（连续信号，核心：低等级+高胜率的组合；成长断层/守护者出门装/闪现异位为加成）
  let smurfSuspicionProbability = 0
  if (lowLevelHighWinRate) {
    smurfSuspicionProbability = 0.7
    if ((playerLevel ?? 999) <= 50) smurfSuspicionProbability = 0.8
    if ((playerLevel ?? 999) <= 30) smurfSuspicionProbability = 0.9
  } else if (playerLevel != null && playerLevel < 100 && overallWinRate >= 0.6) {
    smurfSuspicionProbability = 0.45
  }
  if (growthCliff) {
    smurfSuspicionProbability = Math.max(smurfSuspicionProbability, 0.6)
  }
  if (guardianStartCount >= 3) {
    smurfSuspicionProbability = Math.min(0.95, Math.max(smurfSuspicionProbability, 0.4))
  }
  if (flashSwap) {
    smurfSuspicionProbability = Math.min(0.95, smurfSuspicionProbability + 0.1)
  }
  smurfSuspicionProbability = round(smurfSuspicionProbability, 2)
  const smurfSuspicionLevel: AiEvaluationSuspicionLevel =
    smurfSuspicionProbability >= 0.75
      ? 'high'
      : smurfSuspicionProbability >= 0.5
        ? 'medium'
        : smurfSuspicionProbability > 0
          ? 'low'
          : 'none'
  return {
    player: playerName,
    sampleSize: n,
    dateRange: [entries[n - 1]?.date, entries[0]?.date],
    overall: {
      wins,
      losses: n - wins,
      winRate: round(wins / n, 3),
      winRateCI95: [ciLow, ciHigh],
      avgGameDurationMin: round(mean(agg('durationMin'))),
      avgKills: round(mean(agg('kills'))),
      avgDeaths: round(mean(agg('deaths'))),
      avgAssists: round(mean(agg('assists'))),
      avgKda: round((mean(agg('kills')) + mean(agg('assists'))) / Math.max(1, mean(agg('deaths')))),
      killParticipation: round(mean(agg('killParticipation')), 3),
      dpm: { mean: round(mean(agg('dpm'))), median: round(median(agg('dpm'))) },
      damageShare: {
        mean: round(mean(dmgShares), 3),
        median: round(median(dmgShares), 3),
        stdev: round(stdev(dmgShares), 3)
      },
      avgDamageRankInTeam: round(mean(agg('damageRankInTeam')), 2),
      avgDamageGoldEfficiency: round(mean(agg('damageGoldEfficiency')), 2),
      takenPerMin: round(mean(agg('takenPerMin'))),
      selfMitigatedPerMin: round(mean(agg('selfMitigatedPerMin'))),
      healPerMin: round(mean(agg('healPerMin'))),
      ccPerMin: round(mean(agg('ccPerMin'))),
      deathsPerMin: round(mean(agg('deathsPerMin')), 2),
      multiKillsPerGame: round(mean(agg('multiKills')), 2),
      firstBloodParticipation: round(mean(agg('firstBlood')), 2),
      avgChampLevel: round(mean(agg('level'))),
      surrenderRate: round(mean(agg('surrendered')), 2)
    },
    winLossSplit: {
      whenWinning: {
        games: winsGames.length,
        avgDmgShare: round(mean(winsGames.map((g) => g.damageShare)), 3),
        avgKda: round(mean(winsGames.map((g) => g.kda))),
        avgDeaths: round(mean(winsGames.map((g) => g.deaths)))
      },
      whenLosing: {
        games: losses.length,
        avgDmgShare: round(mean(losses.map((g) => g.damageShare)), 3),
        avgKda: round(mean(losses.map((g) => g.kda))),
        avgDeaths: round(mean(losses.map((g) => g.deaths)))
      }
    },
    consistency: {
      damageShareP25: round(sortedShares[Math.floor(n * 0.25)], 3),
      damageShareP75: round(sortedShares[Math.floor(n * 0.75)], 3),
      bottomQuartileMedianShare: round(median(bottomQuartile), 3),
      badGameRate: round(entries.filter((g) => g.damageShare < 0.15 && g.deaths >= 8).length / n, 2)
    },
    mainPosition,
    conditional,
    championPool: { distinct: championTable.length, table: championTable },
    augmentStats: { avgPerGame: round(augmentSlots / n, 2), table: augmentTable },
    winTrading: {
      heuristicNote:
        '三信号：premadePairRate=投降败局中固定队友对共现率（基线≈0，≥50%即高嫌疑）；advantageSurrenderRate=投降败局中终局经济占比≥55%比例（基线≈0%）；towerLeadSurrenderRate=投降败局推塔净胜≥1比例（基线≈56%，仅辅助印证）',
      losses: losses.length,
      surrenderedLossCount: surrenderedLosses.length,
      premadeTopPairCount: topPairCount,
      premadePairRate,
      advantageSurrenderCount: advantageSurrenderLosses.length,
      advantageSurrenderRate,
      towerLeadSurrenderRate,
      suspicionProbability: winTradingSuspicionProbability,
      suspicionLevel: winTradingSuspicionLevel
    },
    smurf: {
      heuristicNote:
        '仅输出事实信号，可能性由 AI 综合判断：growthCliff=近25场vs更早25场胜率差≥25pp或伤转率差≥30pp（两段各≥10场）；winRateGap/damageGoldEfficiencyGap=前后段差值(pp)；playerLevel/levelScore=账号等级（<100 偏低，越低越可疑）；overallWinRate/highWinRate/lowLevelHighWinRate=总胜率与"低等级+高胜率"组合（小号的典型画像）；guardianStartCount=守护者出门装场次（正常≈0）；flashSwap=D 闪与 F 闪并存',
      signals: {
        growthCliff,
        winRateGap,
        damageGoldEfficiencyGap: dmgEffGap,
        playerLevel: playerLevel ?? null,
        levelScore,
        overallWinRate,
        highWinRate,
        lowLevelHighWinRate,
        guardianStartCount,
        flashSwap
      },
      suspicionProbability: smurfSuspicionProbability,
      suspicionLevel: smurfSuspicionLevel
    }
  }
}
