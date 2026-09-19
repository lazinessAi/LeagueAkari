import { useSummonerFetch } from '@renderer-shared/composables/useSummonerFetch'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { InGameSendRenderer } from '@renderer-shared/shards/in-game-send'
import { IN_GAME_SEND_MAIN_NAMESPACE } from '@renderer-shared/shards/in-game-send/context'
import { useInGameSendStore } from '@renderer-shared/shards/in-game-send/store'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type { InGameSendPresetTargetShortcuts } from '@shared/shards/in-game-send'
import { useTranslation } from 'i18next-vue'
import { computed, reactive, ref, watch } from 'vue'

import type { AramMayhemGameJson } from '../ai-evaluation/aggregate'
import { fetchAramMayhemGameSummaries } from '../ai-evaluation/fetch-player-games'
import { buildHorseGradeReport } from '../ai-evaluation/horse-grade'
import { createShortcutTargetIds } from '../data/shared'
import type { GamePhase, PresetTargetId, PreviewedLines } from '../types'

export type HorseGradeTargetId = PresetTargetId

const SENDABLE_PHASES: GamePhase[] = ['lobby', 'champ-select', 'in-game']

/** 与海斗评价一致的低样本门槛 */
const HORSE_GRADE_MIN_SAMPLE = 10

function getHorseGradeShortcutTargetId(target: PresetTargetId) {
  return `in-game-send-main/horse-grade/${target}`
}

function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim()
  const hashIndex = trimmed.indexOf('#')

  if (hashIndex <= 0 || hashIndex === trimmed.length - 1) {
    return null
  }

  const gameName = trimmed.slice(0, hashIndex).trim()
  const tagLine = trimmed.slice(hashIndex + 1).trim()

  if (!gameName || !tagLine) {
    return null
  }

  return { gameName, tagLine }
}

export function useHorseGrade() {
  const { t } = useTranslation('renderer', {
    keyPrefix: 'toolkit.inGameSend.presets.horseGrade'
  })
  const { t: tAi } = useTranslation('renderer', {
    keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation'
  })

  const ogs = useOngoingGameStore()
  const lcStore = useLeagueClientStore()
  const sgpStore = useSgpStore()
  const igsStore = useInGameSendStore()
  const appCommonStore = useAppCommonStore()
  const sgp = useInstance(SgpRenderer)
  const igs = useInstance(InGameSendRenderer)
  const ipc = useInstance(AkariIpcRenderer)
  const { searchSummonerByAlias } = useSummonerFetch()

  const sgpReady = computed(
    () =>
      sgpStore.isTokenReady &&
      sgpStore.availability.serversSupported.matchHistory &&
      !!sgpStore.availability.sgpServerId
  )

  const gamePhase = computed<GamePhase>(() => {
    const { phase } = ogs.queryStage

    if (phase === 'lobby' || phase === 'champ-select' || phase === 'in-game' || phase === 'draft') {
      return phase
    }

    return 'none'
  })

  const canSend = computed(() => SENDABLE_PHASES.includes(gamePhase.value))

  /**
   * 当前阶段是否真的存在可用的发送通道（与海斗评价一致）：
   * 房间 / 英雄选择依赖 LCU 聊天会话（普通匹配房间在进入英雄选择前没有聊天通道），
   * 游戏内依赖原生键盘模拟（需要管理员权限）。
   */
  const canSendNow = computed(() => {
    if (!canSend.value) {
      return false
    }

    if (gamePhase.value === 'in-game') {
      return appCommonStore.nativeSupport.nativeInput.available
    }

    if (gamePhase.value === 'lobby') {
      return !!lcStore.chat.conversations.customGame
    }

    if (gamePhase.value === 'champ-select') {
      return !!lcStore.chat.conversations.championSelect
    }

    return false
  })

  const shortcutTargetIds = createShortcutTargetIds(getHorseGradeShortcutTargetId)
  const shortcuts = computed<InGameSendPresetTargetShortcuts>(() => ({
    ...igsStore.settings.horseGradeTargetShortcuts
  }))

  async function setShortcut(targetId: PresetTargetId, shortcutId: string | null) {
    return igs.setHorseGradeTargetShortcut(targetId, shortcutId)
  }

  function formatPlayerName(puuid: string): string {
    const summoner = ogs.summoner[puuid]

    if (summoner?.gameName) {
      return summoner.tagLine ? `${summoner.gameName}#${summoner.tagLine}` : summoner.gameName
    }

    return summoner?.displayName || puuid.slice(0, 8)
  }

  // ===== 对局玩家勾选 =====
  const selection = reactive<Record<string, boolean>>({})

  const allGamePlayers = computed(() => {
    const ownPuuid = lcStore.summoner.me?.puuid
    const ownBucket = Object.entries(ogs.teams).find(
      ([, members]) => ownPuuid && members.includes(ownPuuid)
    )
    const ownSet = new Set(ownBucket?.[1] ?? [])

    const seen = new Set<string>()
    const players: {
      puuid: string
      name: string
      gameName: string
      tagLine: string
      isOwnTeam: boolean
      championId: number | null
      profileIconId: number | null
    }[] = []

    for (const members of Object.values(ogs.teams)) {
      for (const puuid of members) {
        if (!puuid || seen.has(puuid)) {
          continue
        }

        seen.add(puuid)
        const summoner = ogs.summoner[puuid]
        players.push({
          puuid,
          name: formatPlayerName(puuid),
          gameName: summoner?.gameName || '',
          tagLine: summoner?.tagLine || '',
          isOwnTeam: ownSet.has(puuid),
          championId: ogs.championSelections[puuid] ?? null,
          profileIconId: summoner?.profileIconId ?? null
        })
      }
    }

    return players
  })

  watch(
    allGamePlayers,
    (players) => {
      for (const player of players) {
        if (!(player.puuid in selection)) {
          selection[player.puuid] = true
        }
      }
    },
    { immediate: true }
  )

  const selectedGamePlayerCount = computed(
    () => allGamePlayers.value.filter((p) => selection[p.puuid] !== false).length
  )

  function isPlayerSelected(puuid: string) {
    return selection[puuid] !== false
  }

  function setPlayerSelected(puuid: string, checked: boolean) {
    selection[puuid] = checked
  }

  function setAllPlayersSelected(checked: boolean) {
    for (const player of allGamePlayers.value) {
      selection[player.puuid] = checked
    }
  }

  function getTargetPlayers(target: HorseGradeTargetId): { puuid: string; name: string }[] {
    const ownPuuid = lcStore.summoner.me?.puuid
    const bucketEntries = Object.entries(ogs.teams).filter(([, members]) => members.length > 0)

    const ownBucket = bucketEntries.find(([, members]) => ownPuuid && members.includes(ownPuuid))

    if (!ownBucket) {
      return []
    }

    const [ownBucketId, ownBucketMembers] = ownBucket
    // LOBBY / TEAM-ALL 是"全员同队"桶，没有敌方
    const isGlobalBucket = (id: string) => id === 'LOBBY' || id === 'TEAM-ALL'

    let puuids: string[]
    if (target === 'friendly') {
      puuids = ownBucketMembers
    } else if (target === 'enemy') {
      puuids = isGlobalBucket(ownBucketId)
        ? []
        : bucketEntries
            .filter(([id]) => id !== ownBucketId && !isGlobalBucket(id))
            .flatMap(([, members]) => members)
    } else {
      const seen = new Set<string>()
      puuids = bucketEntries
        .flatMap(([, members]) => members)
        .filter((puuid) => {
          if (seen.has(puuid)) {
            return false
          }
          seen.add(puuid)
          return true
        })
    }

    return puuids
      .filter(Boolean)
      .filter((puuid) => selection[puuid] !== false)
      .map((puuid) => ({ puuid, name: formatPlayerName(puuid) }))
  }

  // ===== 马种评定执行 =====
  const running = ref(false)
  const generatedLines = reactive<Record<HorseGradeTargetId, PreviewedLines | null>>({
    friendly: null,
    enemy: null,
    all: null
  })
  const previewedLinesRaw = ref<PreviewedLines | null>(null)
  const previewedLines = computed(() => previewedLinesRaw.value)

  /** 名字展示策略（与海斗评价共用同一设置），返回 puuid -> 展示名 */
  function resolveDisplayNames(players: { puuid: string; name: string }[]): Map<string, string> {
    const strategy = igsStore.settings.aiEvaluationNameDisplayStrategy
    const championCounts = new Map<number, number>()

    if (strategy !== 'preferName') {
      for (const player of players) {
        const championId = ogs.championSelections[player.puuid]
        if (championId) {
          championCounts.set(championId, (championCounts.get(championId) ?? 0) + 1)
        }
      }
    }

    const displayNames = new Map<string, string>()
    for (const player of players) {
      const championId = ogs.championSelections[player.puuid] ?? null
      const championName = championId ? lcStore.gameData.champions[championId]?.name : undefined
      const noDuplicate = championId && (championCounts.get(championId) ?? 0) <= 1

      let displayName = player.name
      if (strategy === 'preferChampionName' && championName && noDuplicate) {
        displayName = championName
      } else if (strategy === 'championNameWithName' && championName && noDuplicate) {
        displayName = `${championName}（${player.name}）`
      }

      displayNames.set(player.puuid, displayName)
    }

    return displayNames
  }

  async function dryRun(target: HorseGradeTargetId): Promise<void> {
    if (running.value || !sgpReady.value) {
      return
    }

    const players = getTargetPlayers(target)
    if (!players.length) {
      return
    }

    const displayNames = resolveDisplayNames(players)

    running.value = true
    try {
      // 并发拉取全部选中玩家的近 100 场战绩
      const gameResults = await Promise.all(
        players.map((player) =>
          fetchAramMayhemGameSummaries(sgp, sgpStore.availability.sgpServerId, player.puuid)
            .then((games) => ({ player, games }))
            .catch(() => ({ player, games: [] as AramMayhemGameJson[] }))
        )
      )

      // 跨玩家按 gameId 去重后合并：所有选中玩家的对局共同构成总体基底
      const pooledGames: AramMayhemGameJson[] = []
      const seenGameIds = new Set<number>()
      for (const { games } of gameResults) {
        for (const game of games) {
          if (!seenGameIds.has(game.gameId)) {
            seenGameIds.add(game.gameId)
            pooledGames.push(game)
          }
        }
      }

      const report = buildHorseGradeReport({
        players,
        games: pooledGames,
        champions: lcStore.gameData.champions
      })

      const lines: string[] = []
      if (!report) {
        lines.push(t('noGames'))
      } else {
        for (const player of players) {
          const displayName = displayNames.get(player.puuid) ?? player.name
          const result = report.players.find((p) => p.puuid === player.puuid)

          if (!result || result.metrics.gameCount === 0) {
            lines.push(`${displayName}：${tAi('playerStatus.noData')}`)
            continue
          }

          if (result.metrics.gameCount < HORSE_GRADE_MIN_SAMPLE) {
            lines.push(
              `${displayName}：${tAi('lowSampleReply', { count: result.metrics.gameCount })}`
            )
            continue
          }

          lines.push(
            t('resultLine', {
              name: displayName,
              grade: result.grade,
              subLevel: result.subLevel,
              score: result.score,
              percentile: result.percentile
            })
          )
        }
      }

      generatedLines[target] = { targetId: target, createdAt: Date.now(), lines }
      previewedLinesRaw.value = { targetId: target, createdAt: Date.now(), lines }
    } finally {
      running.value = false
    }
  }

  async function send(target: HorseGradeTargetId): Promise<boolean> {
    if (running.value || !canSendNow.value) {
      return false
    }

    // 未试运行的目标先生成再发送
    if (!generatedLines[target]) {
      await dryRun(target)
    }

    const lines = generatedLines[target]?.lines ?? []
    if (!lines.length) {
      return false
    }

    return igs.sendLines(lines)
  }

  function closePreview() {
    previewedLinesRaw.value = null
  }

  // ===== 手动查询单个玩家 =====
  const manual = reactive({
    input: '',
    sendTarget: 'friendly' as HorseGradeTargetId,
    entry: null as {
      name: string
      displayName: string
      status: 'pending' | 'fetching' | 'analyzing' | 'done' | 'no-data' | 'error'
      reply: string
      errorMessage: string
    } | null,
    running: false,
    errorMessage: ''
  })

  async function runManualEvaluation() {
    if (manual.running) {
      return
    }

    const parsed = parseRiotId(manual.input)
    if (!parsed) {
      manual.errorMessage = tAi('manual.inputInvalid')
      return
    }

    manual.errorMessage = ''
    manual.entry = {
      name: `${parsed.gameName}#${parsed.tagLine}`,
      displayName: `${parsed.gameName}#${parsed.tagLine}`,
      status: 'fetching',
      reply: '',
      errorMessage: ''
    }
    manual.running = true

    try {
      let summoner: { puuid: string; gameName: string; tagLine: string; level: number } | null =
        null
      try {
        const lcuSummoner = await searchSummonerByAlias(parsed.gameName, parsed.tagLine, 'lcu')
        summoner = lcuSummoner
          ? {
              puuid: lcuSummoner.puuid,
              gameName: lcuSummoner.gameName,
              tagLine: lcuSummoner.tagLine,
              level: lcuSummoner.level
            }
          : null
      } catch {
        summoner = null
      }

      if (!summoner && sgpReady.value) {
        const sgpSummoner = await searchSummonerByAlias(
          parsed.gameName,
          parsed.tagLine,
          'sgp',
          sgpStore.availability.sgpServerId
        ).catch(() => null)
        summoner = sgpSummoner
          ? {
              puuid: sgpSummoner.puuid,
              gameName: sgpSummoner.gameName,
              tagLine: sgpSummoner.tagLine,
              level: sgpSummoner.level
            }
          : null
      }

      if (!summoner) {
        manual.entry.status = 'error'
        manual.entry.errorMessage = tAi('manual.notFound')
        return
      }

      manual.entry.displayName = summoner.gameName
        ? summoner.tagLine
          ? `${summoner.gameName}#${summoner.tagLine}`
          : summoner.gameName
        : manual.entry.name

      const games = await fetchAramMayhemGameSummaries(
        sgp,
        sgpStore.availability.sgpServerId,
        summoner.puuid
      )
      manual.entry.status = 'analyzing'

      if (!games.length) {
        manual.entry.status = 'no-data'
        manual.entry.reply = tAi('playerStatus.noData')
        return
      }

      const report = buildHorseGradeReport({
        players: [{ puuid: summoner.puuid, name: manual.entry.displayName }],
        games,
        champions: lcStore.gameData.champions
      })

      if (!report) {
        manual.entry.status = 'no-data'
        manual.entry.reply = t('noGames')
        return
      }

      const result = report.players[0]

      if (result.metrics.gameCount === 0) {
        manual.entry.reply = tAi('playerStatus.noData')
        manual.entry.status = 'done'
        return
      }

      if (result.metrics.gameCount < HORSE_GRADE_MIN_SAMPLE) {
        manual.entry.reply = tAi('lowSampleReply', { count: result.metrics.gameCount })
        manual.entry.status = 'done'
        return
      }

      manual.entry.reply = t('resultDetail', {
        grade: result.grade,
        subLevel: result.subLevel,
        score: result.score,
        percentile: result.percentile
      })
      manual.entry.status = 'done'
    } catch (error) {
      manual.entry.status = 'error'
      manual.entry.errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      manual.running = false
    }
  }

  async function sendManualReply() {
    const entry = manual.entry

    if (!entry || entry.status !== 'done' || !entry.reply) {
      return false
    }

    return igs.sendLines([`${entry.displayName || entry.name}：${entry.reply}`])
  }

  // ===== 快捷键 =====
  ipc.onEventVue(
    IN_GAME_SEND_MAIN_NAMESPACE,
    'horse-grade-shortcut',
    (target: HorseGradeTargetId) => {
      void send(target)
    }
  )

  return {
    // PresetScopeContext 兼容成员
    shortcutTargetIds,
    shortcuts,
    gamePhase,
    canSend,
    canSendNow,
    previewedLines,
    setShortcut,
    send,
    dryRun,
    closePreview,

    // 马种评价扩展
    running,
    generatedLines,
    sgpReady,
    igs,
    igsStore,
    selection,
    allGamePlayers,
    getTargetPlayers,
    selectedGamePlayerCount,
    isPlayerSelected,
    setPlayerSelected,
    setAllPlayersSelected,
    manual,
    manualRunning: computed(() => manual.running),
    runManualEvaluation,
    sendManualReply,
    commonDisabledReason
  }

  function commonDisabledReason(): string {
    if (running.value) {
      return tAi('reasons.running')
    }

    if (!sgpReady.value) {
      return tAi('reasons.sgpUnavailable')
    }

    return ''
  }
}
