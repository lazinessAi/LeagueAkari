import { useSummonerFetch } from '@renderer-shared/composables/useSummonerFetch'
import { useInstance } from '@renderer-shared/shards'
import { AiModelRenderer } from '@renderer-shared/shards/ai-model'
import { useAiModelStore } from '@renderer-shared/shards/ai-model/store'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import { InGameSendRenderer } from '@renderer-shared/shards/in-game-send'
import { IN_GAME_SEND_MAIN_NAMESPACE } from '@renderer-shared/shards/in-game-send/context'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useOngoingGameStore } from '@renderer-shared/shards/ongoing-game/store'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { useTranslation } from 'i18next-vue'
import { computed, reactive } from 'vue'

import { buildAramMayhemReport } from './aggregate'
import {
  AI_EVALUATION_CHAT_LINE_MAX_LENGTH,
  AI_EVALUATION_CHAT_OPTIONS,
  AI_EVALUATION_CONCURRENCY,
  AI_EVALUATION_MIN_SAMPLE
} from './constants'
import { extractEvaluationSentence } from './extract'
import { fetchAramMayhemGameSummaries } from './fetch-player-games'
import { AI_EVALUATION_SYSTEM_PROMPT, buildAiEvaluationUserMessage } from './prompt'

export type AiEvaluationTargetId = 'friendly' | 'enemy' | 'all'

export type AiEvaluationPlayerStatus =
  'pending' | 'fetching' | 'analyzing' | 'done' | 'no-data' | 'error'

export interface AiEvaluationPlayerEntry {
  puuid: string
  name: string
  status: AiEvaluationPlayerStatus
  reply: string
  errorMessage: string
}

export interface AiEvaluationRowState {
  status: 'idle' | 'running' | 'ready'
  evaluations: AiEvaluationPlayerEntry[]
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

/** 每名玩家一条消息（玩家名前缀），超长按句再切 */
function buildEvaluationChatLines(evaluations: AiEvaluationPlayerEntry[]): string[] {
  const lines: string[] = []

  for (const evaluation of evaluations) {
    if (evaluation.status !== 'done' || !evaluation.reply) {
      continue
    }

    for (const paragraph of evaluation.reply
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const prefixed = `${evaluation.name}：${paragraph}`
      lines.push(...splitLongLine(prefixed, AI_EVALUATION_CHAT_LINE_MAX_LENGTH))
    }
  }

  return lines
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

async function runWithConcurrency(tasks: (() => Promise<void>)[], limit: number) {
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const task = queue.shift()
      if (task) {
        await task()
      }
    }
  })

  await Promise.all(workers)
}

export function useAiEvaluation() {
  const { t } = useTranslation('renderer', {
    keyPrefix: 'toolkit.inGameSend.presets.aiEvaluation'
  })

  const ogs = useOngoingGameStore()
  const lcStore = useLeagueClientStore()
  const sgpStore = useSgpStore()
  const aiModelStore = useAiModelStore()
  const extraAssetsStore = useExtraAssetsStore()
  const sgp = useInstance(SgpRenderer)
  const aiModel = useInstance(AiModelRenderer)
  const igs = useInstance(InGameSendRenderer)
  const ipc = useInstance(AkariIpcRenderer)
  const { searchSummonerByAlias } = useSummonerFetch()

  const rows = reactive<Record<AiEvaluationTargetId, AiEvaluationRowState>>({
    friendly: { status: 'idle', evaluations: [] },
    enemy: { status: 'idle', evaluations: [] },
    all: { status: 'idle', evaluations: [] }
  })

  const manual = reactive({
    input: '',
    /** 手动模块发送到聊天时的语义目标（发送本身走当前阶段聊天） */
    sendTarget: 'friendly' as AiEvaluationTargetId,
    entry: null as AiEvaluationPlayerEntry | null,
    errorMessage: ''
  })

  const sgpReady = computed(
    () =>
      sgpStore.isTokenReady &&
      sgpStore.availability.serversSupported.matchHistory &&
      !!sgpStore.availability.sgpServerId
  )

  const activeModelConfig = computed(() =>
    aiModelStore.settings.configs.find(
      (config) => config.id === aiModelStore.settings.activeConfigId
    )
  )

  // 这些阶段下 ongoing-game 已有成员数据（房间为 LOBBY 桶，选人/对局为 TEAM-100/200）
  const PLAYER_READY_PHASES = ['lobby', 'draft', 'champ-select', 'in-game']

  const ongoingGameReady = computed(() =>
    (PLAYER_READY_PHASES as string[]).includes(ogs.queryStage.phase)
  )

  const anyRowRunning = computed(() => Object.values(rows).some((row) => row.status === 'running'))

  const manualRunning = computed(
    () => manual.entry?.status === 'fetching' || manual.entry?.status === 'analyzing'
  )

  function commonDisabledReason(): string {
    if (!sgpReady.value) {
      return t('reasons.sgpUnavailable')
    }

    if (!activeModelConfig.value) {
      return t('reasons.noActiveModel')
    }

    return ''
  }

  function getTargetDisabledReason(target: AiEvaluationTargetId): string {
    if (!ongoingGameReady.value) {
      return t('reasons.noOngoingGame')
    }

    if (rows[target].status === 'running') {
      return t('reasons.running')
    }

    if (target !== 'friendly' && anyRowRunning.value) {
      return t('reasons.running')
    }

    return commonDisabledReason()
  }

  function getTargetSendDisabledReason(target: AiEvaluationTargetId): string {
    if (rows[target].status === 'running') {
      return t('reasons.running')
    }

    if (rows[target].status !== 'ready') {
      return t('reasons.notReady')
    }

    return ''
  }

  function formatPlayerName(puuid: string): string {
    const summoner = ogs.summoner[puuid]

    if (summoner?.gameName) {
      return summoner.tagLine ? `${summoner.gameName}#${summoner.tagLine}` : summoner.gameName
    }

    return summoner?.displayName || puuid.slice(0, 8)
  }

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

    return puuids.filter(Boolean).map((puuid) => ({ puuid, name: formatPlayerName(puuid) }))
  }

  async function evaluatePlayer(entry: AiEvaluationPlayerEntry) {
    entry.status = 'fetching'

    try {
      const games = await fetchAramMayhemGameSummaries(
        sgp,
        sgpStore.availability.sgpServerId,
        entry.puuid
      )

      if (!games.length) {
        entry.status = 'no-data'
        return
      }

      entry.status = 'analyzing'

      const report = buildAramMayhemReport({
        playerName: entry.name,
        playerPuuid: entry.puuid,
        games,
        champions: lcStore.gameData.champions,
        kiwiAugments: extraAssetsStore.kiwiAugmentsMap
      })

      if (!report) {
        entry.status = 'no-data'
        return
      }

      // 极小样本下模型输出不可控，不发起 AI 调用，直接给确定性文案
      if (report.sampleSize < AI_EVALUATION_MIN_SAMPLE) {
        entry.reply = t('lowSampleReply', { count: report.sampleSize })
        entry.status = 'done'
        return
      }

      const result = await aiModel.chatCompletion(
        [
          { role: 'system', content: AI_EVALUATION_SYSTEM_PROMPT },
          { role: 'user', content: buildAiEvaluationUserMessage(entry.name, report) }
        ],
        AI_EVALUATION_CHAT_OPTIONS
      )

      if (result.ok) {
        entry.reply = extractEvaluationSentence(entry.name, result.reply)
        entry.status = 'done'
      } else {
        entry.status = 'error'
        entry.errorMessage = `${result.reason}: ${result.message}`
      }
    } catch (error) {
      entry.status = 'error'
      entry.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  async function runTargetEvaluation(target: AiEvaluationTargetId) {
    const row = rows[target]

    if (row.status === 'running' || getTargetDisabledReason(target)) {
      return
    }

    const players = getTargetPlayers(target)
    if (!players.length) {
      return
    }

    row.evaluations = players.map((player) => ({
      ...player,
      status: 'pending',
      reply: '',
      errorMessage: ''
    }))
    row.status = 'running'

    await runWithConcurrency(
      row.evaluations.map((entry) => async () => {
        await evaluatePlayer(entry)
      }),
      AI_EVALUATION_CONCURRENCY
    )

    row.status = 'ready'
  }

  function sendTargetReplies(target: AiEvaluationTargetId) {
    const row = rows[target]

    if (row.status !== 'ready' || getTargetSendDisabledReason(target)) {
      return Promise.resolve(false)
    }

    const lines = buildEvaluationChatLines(row.evaluations)
    if (!lines.length) {
      return Promise.resolve(false)
    }

    return igs.sendLines(lines)
  }

  async function runManualEvaluation() {
    if (manualRunning.value) {
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
      status: 'fetching',
      reply: '',
      errorMessage: ''
    }

    let summoner: NonNullable<Awaited<ReturnType<typeof searchSummonerByAlias>>> | null = null
    try {
      summoner = await searchSummonerByAlias(parsed.gameName, parsed.tagLine, 'lcu')
    } catch {
      summoner = null
    }

    if (!summoner && sgpReady.value) {
      summoner = await searchSummonerByAlias(
        parsed.gameName,
        parsed.tagLine,
        'sgp',
        sgpStore.availability.sgpServerId
      ).catch(() => null)
    }

    if (!summoner) {
      manual.entry.status = 'error'
      manual.entry.errorMessage = t('manual.notFound')
      return
    }

    manual.entry.puuid = summoner.puuid
    manual.entry.name = summoner.gameName
      ? summoner.tagLine
        ? `${summoner.gameName}#${summoner.tagLine}`
        : summoner.gameName
      : manual.entry.name

    await evaluatePlayer(manual.entry)
  }

  function sendManualReply() {
    const entry = manual.entry

    if (!entry || entry.status !== 'done' || !entry.reply) {
      return Promise.resolve(false)
    }

    const lines = buildEvaluationChatLines([entry])
    if (!lines.length) {
      return Promise.resolve(false)
    }

    return igs.sendLines(lines)
  }

  // 主进程快捷键按下 -> 渲染端执行该目标的发送（回复已就绪时）
  ipc.onEventVue(
    IN_GAME_SEND_MAIN_NAMESPACE,
    'ai-evaluation-shortcut',
    (target: AiEvaluationTargetId) => {
      void sendTargetReplies(target)
    }
  )

  return {
    rows,
    manual,
    sgpReady,
    commonDisabledReason,
    activeModelConfig,
    ongoingGameReady,
    anyRowRunning,
    manualRunning,
    getTargetDisabledReason,
    getTargetSendDisabledReason,
    getTargetPlayers,
    runTargetEvaluation,
    sendTargetReplies,
    runManualEvaluation,
    sendManualReply
  }
}
