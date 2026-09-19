import { useSummonerFetch } from '@renderer-shared/composables/useSummonerFetch'
import { useInstance } from '@renderer-shared/shards'
import { InGameSendRenderer } from '@renderer-shared/shards/in-game-send'
import { IN_GAME_SEND_MAIN_NAMESPACE } from '@renderer-shared/shards/in-game-send/context'
import { useInGameSendStore } from '@renderer-shared/shards/in-game-send/store'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { useTranslation } from 'i18next-vue'
import { computed, reactive, ref } from 'vue'

import { fetchAramMayhemGameSummaries } from '../ai-evaluation/fetch-player-games'
import type { HorseGradeGameJson } from '../ai-evaluation/horse-grade'
import { buildHorseGradeReport } from '../ai-evaluation/horse-grade'
import { createShortcutTargetIds } from '../data/shared'
import type { GamePhase, PresetTargetId, PreviewedLines } from '../types'

export type HorseGradeTargetId = PresetTargetId

const SENDABLE_PHASES: GamePhase[] = ['lobby', 'champ-select', 'in-game']

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

/**
 * 海斗马种评价的作用域适配器：与海斗评价同构，复用预设 tab 的按钮/样式/交互。
 */
export function useHorseGrade() {
  const { t } = useTranslation('renderer', {
    keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation'
  })

  const ogs = useOngoingGameStore()
  const lcStore = useLeagueClientStore()
  const sgpStore = useSgpStore()
  const igsStore = useInGameSendStore()
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

  const shortcutTargetIds = createShortcutTargetIds(getHorseGradeShortcutTargetId)
  const shortcuts = computed(() => ({
    ...igsStore.settings.horseGradeTargetShortcuts
  }))

  async function setShortcut(targetId: PresetTargetId, shortcutId: string | null) {
    return igs.setHorseGradeTargetShortcut(targetId, shortcutId)
  }

  const running = ref(false)
  const generatedLines = reactive<Record<HorseGradeTargetId, PreviewedLines | null>>({
    friendly: null,
    enemy: null,
    all: null
  })
  const previewedRaw = ref<PreviewedLines | null>(null)

  function getTargetPlayers(target: HorseGradeTargetId): { puuid: string; name: string }[] {
    const ownPuuid = lcStore.summoner.me?.puuid
    const bucketEntries = Object.entries(ogs.teams).filter(([, members]) => members.length > 0)

    const ownBucket = bucketEntries.find(([, members]) => ownPuuid && members.includes(ownPuuid))

    if (!ownBucket) {
      return []
    }

    const [ownBucketId, ownBucketMembers] = ownBucket
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

    return puuids.filter(Boolean).map((puuid) => ({ puuid, name: formatPlayerName(puuid) }))
  }

  function formatPlayerName(puuid: string): string {
    const summoner = ogs.summoner[puuid]

    if (summoner?.gameName) {
      return summoner.tagLine ? `${summoner.gameName}#${summoner.tagLine}` : summoner.gameName
    }

    return summoner?.displayName || puuid.slice(0, 8)
  }

  async function dryRun(target: HorseGradeTargetId): Promise<void> {
    if (running.value || !sgpReady.value) {
      return
    }

    const players = getTargetPlayers(target)
    if (!players.length) {
      return
    }

    running.value = true
    try {
      // 并发拉取全部选中玩家的战绩
      const gameResults = await Promise.all(
        players.map((player) =>
          fetchAramMayhemGameSummaries(sgp, sgpStore.availability.sgpServerId, player.puuid)
            .then((games) => ({ player, games }))
            .catch(() => ({ player, games: [] as HorseGradeGameJson[] }))
        )
      )

      // 跨玩家去重对局
      const allGames: import('../ai-evaluation/aggregate').AramMayhemGameJson[] = []
      const seenGameIds = new Set<number>()
      for (const { games } of gameResults) {
        for (const game of games) {
          if (!seenGameIds.has(game.gameId)) {
            seenGameIds.add(game.gameId)
            allGames.push(game)
          }
        }
      }

      const itemNames: Record<number, string> = {}
      for (const [id, item] of Object.entries(lcStore.gameData.items)) {
        itemNames[Number(id)] = item.name
      }

      const report = buildHorseGradeReport({
        players,
        games: allGames,
        champions: lcStore.gameData.champions
      })

      const lines: string[] = []
      if (!report) {
        lines.push(t('noGames'))
      } else {
        for (const player of players) {
          // 有参战记录的玩家才显示马种
          const result = report.players.find((p) => p.puuid === player.puuid)
          lines.push(
            result
              ? `${player.name}：${result.grade}·${result.subLevel}（评分 ${result.score}，超过 ${result.percentile}% 的玩家）`
              : `${player.name}：${t('playerStatus.noData')}`
          )
        }
      }

      generatedLines[target] = { targetId: target, createdAt: Date.now(), lines }
      previewedRaw.value = { targetId: target, createdAt: Date.now(), lines }
    } finally {
      running.value = false
    }
  }

  async function send(target: HorseGradeTargetId): Promise<boolean> {
    if (running.value || !canSend.value) {
      return false
    }

    if (!generatedLines[target]) {
      await dryRun(target)
    }

    const lines = generatedLines[target]?.lines ?? []
    if (!lines.length) {
      return false
    }

    return igs.sendLines(lines)
  }

  // ===== 手动查询（单玩家马种） =====
  const manual = reactive({
    input: '',
    entry: null as { name: string; displayName: string; status: string; text: string } | null,
    running: false,
    errorMessage: ''
  })

  async function runManualEvaluation() {
    if (manual.running) {
      return
    }

    const parsed = parseRiotId(manual.input)
    if (!parsed) {
      manual.errorMessage = t('manual.inputInvalid')
      return
    }

    manual.errorMessage = ''
    manual.entry = {
      name: `${parsed.gameName}#${parsed.tagLine}`,
      displayName: `${parsed.gameName}#${parsed.tagLine}`,
      status: 'fetching',
      text: ''
    }
    manual.running = true

    try {
      let summoner: { puuid: string; gameName: string; tagLine: string; level: number } | null =
        null
      try {
        const s = await searchSummonerByAlias(parsed.gameName, parsed.tagLine, 'lcu')
        summoner = s
          ? { puuid: s.puuid, gameName: s.gameName, tagLine: s.tagLine, level: s.level }
          : null
      } catch {
        summoner = null
      }

      if (!summoner && sgpReady.value) {
        const s = await searchSummonerByAlias(
          parsed.gameName,
          parsed.tagLine,
          'sgp',
          sgpStore.availability.sgpServerId
        ).catch(() => null)
        summoner = s
          ? { puuid: s.puuid, gameName: s.gameName, tagLine: s.tagLine, level: s.level }
          : null
      }

      if (!summoner) {
        manual.entry.status = 'error'
        manual.errorMessage = t('manual.notFound')
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
        return
      }

      const itemNames: Record<number, string> = {}
      for (const [id, item] of Object.entries(lcStore.gameData.items)) {
        itemNames[Number(id)] = item.name
      }

      const report = buildHorseGradeReport({
        players: [{ puuid: summoner.puuid, name: manual.entry.displayName }],
        games,
        champions: lcStore.gameData.champions
      })

      if (!report) {
        manual.entry.status = 'no-data'
        return
      }

      const player = report.players[0]
      if (player.metrics.gameCount < 10) {
        manual.entry.status = 'done'
        manual.entry.text = t('lowSampleReply', { count: player.metrics.gameCount })
        return
      }

      manual.entry.text = `${player.grade}·${player.subLevel}（评分 ${player.score}，超过 ${player.percentile}% 的玩家，参与 ${player.metrics.gameCount} 场）`
      manual.entry.status = 'done'
    } catch (error) {
      manual.entry.status = 'error'
      manual.errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      manual.running = false
    }
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
    previewedLines: computed(() => previewedRaw.value),
    setShortcut,
    send,
    dryRun,
    closePreview: () => {
      previewedRaw.value = null
    },

    // 扩展
    running,
    generatedLines,
    sgpReady,
    manual,
    manualRunning: computed(() => manual.running),
    runManualEvaluation,
    commonDisabledReason
  }

  function commonDisabledReason(): string {
    if (running.value) {
      return t('reasons.running')
    }

    if (!sgpReady.value) {
      return t('reasons.sgpUnavailable')
    }

    return ''
  }
}
