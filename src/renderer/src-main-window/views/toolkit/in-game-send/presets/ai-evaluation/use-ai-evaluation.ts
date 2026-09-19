import { useSummonerFetch } from '@renderer-shared/composables/useSummonerFetch'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import { InGameSendRenderer } from '@renderer-shared/shards/in-game-send'
import { IN_GAME_SEND_MAIN_NAMESPACE } from '@renderer-shared/shards/in-game-send/context'
import { useInGameSendStore } from '@renderer-shared/shards/in-game-send/store'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type {
  InGameSendPresetNameDisplayStrategy,
  InGameSendPresetTargetShortcuts
} from '@shared/shards/in-game-send'
import { useTranslation } from 'i18next-vue'
import { computed, reactive, ref, watch } from 'vue'

import { createShortcutTargetIds } from '../data/shared'
import type { GamePhase, PresetTargetId, PreviewedLines } from '../types'
import { buildAramMayhemReport, buildEvaluationText } from './aggregate'
import {
  AI_EVALUATION_CHAT_LINE_MAX_LENGTH,
  AI_EVALUATION_CONCURRENCY,
  AI_EVALUATION_MIN_SAMPLE
} from './constants'
import { fetchAramMayhemGameSummaries } from './fetch-player-games'

export type AiEvaluationTargetId = PresetTargetId

export interface AiEvaluationPlayerEntry {
  puuid: string
  name: string
  displayName: string
  status: 'pending' | 'fetching' | 'analyzing' | 'done' | 'no-data' | 'error'
  reply: string
  errorMessage: string
}

const SENDABLE_PHASES: GamePhase[] = ['lobby', 'champ-select', 'in-game']

function getAiEvaluationShortcutTargetId(target: PresetTargetId) {
  return `in-game-send-main/ai-evaluation/${target}`
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

/** 按句切分超长文本，保证每条不超过游戏聊天的长度上限 */
function splitLongLine(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text]
  }

  const sentences = text.split(/(?<=[。！？!?；;])/)
  const lines: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (!sentence) continue

    if (current && (current + sentence).length > maxLength) {
      lines.push(current)
      current = sentence
    } else {
      current += sentence
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines.length ? lines : [text]
}

function splitLongLines(lines: string[]): string[] {
  const result: string[] = []

  for (const line of lines) {
    result.push(...splitLongLine(line, AI_EVALUATION_CHAT_LINE_MAX_LENGTH))
  }

  return result
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const queue = [...tasks]
  const results: T[] = []
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const task = queue.shift()
      if (task) {
        results.push(await task())
      }
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * 海斗评价的作用域适配器：产出与预设 tab 相同的 PresetScopeContext，
 * 从而直接复用 PresetSendControls / PreviewPanel 的按钮、样式与交互。
 */
export function useAiEvaluation() {
  const { t } = useTranslation('renderer', {
    keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation'
  })

  const ogs = useOngoingGameStore()
  const lcStore = useLeagueClientStore()
  const sgpStore = useSgpStore()
  const igsStore = useInGameSendStore()
  const extraAssetsStore = useExtraAssetsStore()
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

  function formatPlayerName(puuid: string): string {
    const summoner = ogs.summoner[puuid]

    if (summoner?.gameName) {
      return summoner.tagLine ? `${summoner.gameName}#${summoner.tagLine}` : summoner.gameName
    }

    return summoner?.displayName || puuid.slice(0, 8)
  }

  // ===== PresetScopeContext 适配 =====
  const gamePhase = computed<GamePhase>(() => {
    const { phase } = ogs.queryStage

    if (phase === 'lobby' || phase === 'champ-select' || phase === 'in-game' || phase === 'draft') {
      return phase
    }

    return 'none'
  })

  const canSend = computed(() => SENDABLE_PHASES.includes(gamePhase.value))

  /**
   * 当前阶段是否真的存在可用的发送通道：
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

  const shortcutTargetIds = createShortcutTargetIds(getAiEvaluationShortcutTargetId)
  const shortcuts = computed<InGameSendPresetTargetShortcuts>(() => ({
    ...igsStore.settings.aiEvaluationTargetShortcuts
  }))

  async function setShortcut(targetId: PresetTargetId, shortcutId: string | null) {
    return igs.setAiEvaluationTargetShortcut(targetId, shortcutId)
  }

  // ===== 评价执行 =====
  const running = ref(false)
  const evaluations = reactive<Record<AiEvaluationTargetId, AiEvaluationPlayerEntry[]>>({
    friendly: [],
    enemy: [],
    all: []
  })
  const generatedLines = reactive<Record<AiEvaluationTargetId, PreviewedLines | null>>({
    friendly: null,
    enemy: null,
    all: null
  })
  const previewedLinesRaw = ref<PreviewedLines | null>(null)
  const previewedLines = computed(() => previewedLinesRaw.value)

  function getTargetPlayers(target: AiEvaluationTargetId): { puuid: string; name: string }[] {
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

  async function evaluatePlayer(
    entry: AiEvaluationPlayerEntry,
    playerLevel?: number | null
  ): Promise<string> {
    entry.status = 'fetching'

    try {
      const games = await fetchAramMayhemGameSummaries(
        sgp,
        sgpStore.availability.sgpServerId,
        entry.puuid
      )

      if (!games.length) {
        entry.status = 'no-data'
        entry.reply = t('playerStatus.noData')
        return `${entry.displayName || entry.name}：${entry.reply}`
      }

      entry.status = 'analyzing'

      const itemNames: Record<number, string> = {}
      for (const [id, item] of Object.entries(lcStore.gameData.items)) {
        itemNames[Number(id)] = item.name
      }

      const report = buildAramMayhemReport({
        playerName: entry.displayName || entry.name,
        playerPuuid: entry.puuid,
        playerLevel,
        games,
        champions: lcStore.gameData.champions,
        kiwiAugments: extraAssetsStore.kiwiAugmentsMap,
        itemNames
      })

      if (!report) {
        entry.status = 'no-data'
        entry.reply = t('playerStatus.noData')
        return `${entry.displayName || entry.name}：${entry.reply}`
      }

      if (report.sampleSize < AI_EVALUATION_MIN_SAMPLE) {
        entry.status = 'done'
        entry.reply = t('lowSampleReply', { count: report.sampleSize })
        return `${entry.displayName || entry.name}：${entry.reply}`
      }

      entry.reply = buildEvaluationText(report)
      entry.status = 'done'
      return `${entry.displayName || entry.name}：${entry.reply}`
    } catch (error) {
      entry.status = 'error'
      entry.errorMessage = error instanceof Error ? error.message : String(error)
      entry.reply = t('playerStatus.error', { message: entry.errorMessage })
      return `${entry.displayName || entry.name}：${entry.reply}`
    }
  }

  async function dryRun(target: AiEvaluationTargetId): Promise<void> {
    if (running.value || !sgpReady.value) {
      return
    }

    const players = getTargetPlayers(target)
    const strategy = igsStore.settings.aiEvaluationNameDisplayStrategy

    // 名字展示策略：优先英雄名时，存在重复英雄则回退玩家名（避免聊天里分不清）
    const championCounts = new Map<number, number>()
    if (strategy !== 'preferName') {
      for (const player of players) {
        const championId = ogs.championSelections[player.puuid]
        if (championId) {
          championCounts.set(championId, (championCounts.get(championId) ?? 0) + 1)
        }
      }
    }

    const entries: AiEvaluationPlayerEntry[] = players.map((player) => {
      const championId = ogs.championSelections[player.puuid] ?? null
      const championName = championId ? lcStore.gameData.champions[championId]?.name : undefined
      const noDuplicate = championId && (championCounts.get(championId) ?? 0) <= 1

      let displayName = player.name
      if (strategy === 'preferChampionName' && championName && noDuplicate) {
        displayName = championName
      } else if (strategy === 'championNameWithName' && championName && noDuplicate) {
        displayName = `${championName}（${player.name}）`
      }

      return {
        puuid: player.puuid,
        name: player.name,
        displayName,
        status: 'pending',
        reply: '',
        errorMessage: ''
      }
    })
    evaluations[target] = entries

    running.value = true
    try {
      await runWithConcurrency(
        entries.map(
          (entry) => () => evaluatePlayer(entry, ogs.summoner[entry.puuid]?.summonerLevel ?? null)
        ),
        AI_EVALUATION_CONCURRENCY
      )

      const lines = entries.map((entry) => `${entry.displayName || entry.name}：${entry.reply}`)
      generatedLines[target] = { targetId: target, createdAt: Date.now(), lines }
      previewedLinesRaw.value = { targetId: target, createdAt: Date.now(), lines }
    } finally {
      running.value = false
    }
  }

  async function send(target: AiEvaluationTargetId): Promise<boolean> {
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

    return igs.sendLines(splitLongLines(lines))
  }

  function closePreview() {
    previewedLinesRaw.value = null
  }

  // ===== 手动查询 =====
  const manual = reactive({
    input: '',
    sendTarget: 'friendly' as AiEvaluationTargetId,
    entry: null as AiEvaluationPlayerEntry | null,
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
      puuid: '',
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
        manual.entry.errorMessage = t('manual.notFound')
        return
      }

      manual.entry.puuid = summoner.puuid
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

      const report = buildAramMayhemReport({
        playerName: manual.entry.displayName,
        playerPuuid: summoner.puuid,
        playerLevel: summoner.level ?? null,
        games,
        champions: lcStore.gameData.champions,
        kiwiAugments: extraAssetsStore.kiwiAugmentsMap,
        itemNames
      })

      if (!report) {
        manual.entry.status = 'no-data'
        return
      }

      if (report.sampleSize < AI_EVALUATION_MIN_SAMPLE) {
        manual.entry.reply = t('lowSampleReply', { count: report.sampleSize })
        manual.entry.status = 'done'
        return
      }

      manual.entry.reply = buildEvaluationText(report)
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

    const lines = splitLongLines([`${entry.displayName || entry.name}：${entry.reply}`])
    if (!lines.length) {
      return false
    }

    return igs.sendLines(lines)
  }

  // ===== 快捷键 =====
  ipc.onEventVue(
    IN_GAME_SEND_MAIN_NAMESPACE,
    'ai-evaluation-shortcut',
    (target: AiEvaluationTargetId) => {
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

    // 海斗评价扩展
    running,
    evaluations,
    generatedLines,
    selection,
    allGamePlayers,
    getTargetPlayers,
    selectedGamePlayerCount,
    isPlayerSelected,
    setPlayerSelected,
    setAllPlayersSelected,
    sgpReady,
    manual,
    manualRunning: computed(() => manual.running),
    runManualEvaluation,
    sendManualReply,
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

/** 名字展示策略设置（供面板绑定） */
export function useAiEvaluationNameDisplay() {
  const igsStore = useInGameSendStore()
  const igs = useInstance(InGameSendRenderer)

  const strategy = computed(() => igsStore.settings.aiEvaluationNameDisplayStrategy)

  function setStrategy(value: InGameSendPresetNameDisplayStrategy) {
    return igs.setAiEvaluationNameDisplayStrategy(value)
  }

  return { strategy, setStrategy }
}
