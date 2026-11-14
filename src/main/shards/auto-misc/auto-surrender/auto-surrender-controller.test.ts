import { observable, reaction, runInAction } from 'mobx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoMiscMainContext } from '../context'
import { AutoMiscSettings } from '../state'
import { AutoSurrenderController } from './auto-surrender-controller'
import { matchesSurrenderMessage } from './match-message'
import { SurrenderOcrError, type SurrenderOcrResult } from './ocr-executor'
import { AutoSurrenderState } from './state'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const announcement: SurrenderOcrResult = {
  text: '16:30 蓝 色 军 团 同 意 投 降 ! 4 票 赞 成 , 0 票 反 对 。',
  durationMs: 153,
  skipped: false
}

function createHarness(
  options: {
    enabled?: boolean
    phase?: string
    available?: boolean
    noSession?: boolean
  } = {}
) {
  const settings = new AutoMiscSettings()
  settings.autoSurrenderEnabled = options.enabled ?? true
  const gameflow = observable({
    phase: options.phase ?? 'InProgress',
    session: options.noSession ? null : { gameData: { gameId: 1 } }
  })
  const context = {
    settings,
    leagueClient: { data: { gameflow } },
    mobxUtils: { reaction },
    logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as AutoMiscMainContext
  const result = deferred<SurrenderOcrResult>()
  const ocr = {
    start: vi.fn(async () => {}),
    scan: vi.fn(() => result.promise),
    dispose: vi.fn()
  }
  const dependencies = {
    isAvailable: vi.fn(() => options.available ?? true),
    isGameForeground: vi.fn(async () => true),
    createOcr: vi.fn(() => ocr),
    sendSurrender: vi.fn(async (_signal: AbortSignal) => true)
  }
  const state = new AutoSurrenderState()
  const controller = new AutoSurrenderController(context, state, dependencies)
  controller.watch()
  return { settings, gameflow, ocr, dependencies, state, controller, result }
}

describe('surrender announcement matching', () => {
  it.each([
    '敌方军团同意投降！4票赞成，0票反对。',
    '蓝 色 军 团 同 意 投 降 ! 4 票 赞 成 , 1 票 反 对 。',
    '红色军团同意投降',
    '我方军团同意投降。'
  ])(
    'recognizes the first announcement without depending on army name or vote counts: %s',
    (text) => {
      expect(matchesSurrenderMessage(text)).toBe(true)
    }
  )

  it.each(['红色军团正在向胜利迈进！', '敌方发起了投降投票', '投降失败', '同意投降'])(
    'ignores unrelated messages: %s',
    (text) => {
      expect(matchesSurrenderMessage(text)).toBe(false)
    }
  )
})

describe('automatic surrender lifecycle', () => {
  let harness: ReturnType<typeof createHarness> | undefined
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    harness?.controller.dispose()
    harness = undefined
    vi.useRealTimers()
  })

  it.each([
    { enabled: false },
    { phase: 'WatchInProgress' },
    { phase: 'None' },
    { noSession: true },
    { available: false }
  ])('does not start capture/input when unavailable: %j', async (options) => {
    harness = createHarness(options)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.createOcr).not.toHaveBeenCalled()
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('ignores a skipped frame even if it contains stale text', async () => {
    harness = createHarness()
    harness.result.resolve({ ...announcement, skipped: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.status).toBe('paused')
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('reports an input failure and does not retry it', async () => {
    harness = createHarness()
    harness.dependencies.sendSurrender.mockRejectedValue(new Error('native input failed'))
    harness.result.resolve(announcement)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.state.error).toBe('send-failed')
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it('sends on the first announcement and never resends in the same game, including after toggling', async () => {
    harness = createHarness()
    harness.result.resolve(announcement)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.status).toBe('triggered')
    expect(harness.ocr.dispose).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = false
    })
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.dependencies.createOcr).toHaveBeenCalledTimes(1)
  })

  it('arms again for a new game', async () => {
    harness = createHarness()
    harness.result.resolve(announcement)
    await vi.advanceTimersByTimeAsync(0)
    runInAction(() => {
      harness!.gameflow.session!.gameData.gameId = 2
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
  })

  it.each(['disable', 'end', 'new-game'] as const)(
    'discards an old recognition result after %s',
    async (change) => {
      harness = createHarness()
      await vi.advanceTimersByTimeAsync(0)
      runInAction(() => {
        if (change === 'disable') harness!.settings.autoSurrenderEnabled = false
        if (change === 'end') harness!.gameflow.phase = 'EndOfGame'
        if (change === 'new-game') harness!.gameflow.session!.gameData.gameId = 2
      })
      // A new game receives its own fresh frame; only the old in-flight result is an announcement.
      harness.ocr.scan.mockImplementation(() => new Promise(() => {}))
      harness.result.resolve(announcement)
      await vi.advanceTimersByTimeAsync(0)
      expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    }
  )

  it('does not consume the game if focus was lost after recognition', async () => {
    harness = createHarness()
    harness.dependencies.isGameForeground.mockResolvedValue(false)
    harness.result.resolve(announcement)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    harness.dependencies.isGameForeground.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(150)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it.each(['PreEndOfGame', 'WaitingForStats'])(
    'keeps the warm OCR worker through %s to preserve the surrender window',
    async (phase) => {
      harness = createHarness()
      await vi.advanceTimersByTimeAsync(0)
      runInAction(() => {
        harness!.gameflow.phase = phase
      })
      harness.result.resolve(announcement)
      await vi.advanceTimersByTimeAsync(0)
      expect(harness.dependencies.createOcr).toHaveBeenCalledTimes(1)
      expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    }
  )

  it('aborts pending input when disabled and does not retry a consumed game', async () => {
    harness = createHarness()
    const sending = deferred<boolean>()
    harness.dependencies.sendSurrender.mockImplementation(() => sending.promise)
    harness.result.resolve(announcement)
    await vi.advanceTimersByTimeAsync(0)
    const signal = harness.dependencies.sendSurrender.mock.calls[0][0]
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = false
    })
    expect(signal.aborted).toBe(true)
    sending.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.status).toBe('idle')
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = true
    })
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it('waits for each OCR frame rather than accumulating scans', async () => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(2000)
    expect(harness.ocr.scan).toHaveBeenCalledTimes(1)
    harness.result.resolve({ ...announcement, text: '红色军团正在向胜利迈进！' })
    await vi.advanceTimersByTimeAsync(149)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    expect(harness.ocr.scan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.ocr.scan).toHaveBeenCalledTimes(2)
  })

  it('reports missing Chinese OCR and stops instead of silently spinning', async () => {
    harness = createHarness()
    harness.ocr.start.mockRejectedValue(new SurrenderOcrError('ocr-language-unavailable'))
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = false
    })
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.status).toBe('error')
    expect(harness.state.error).toBe('ocr-language-unavailable')
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })
})
