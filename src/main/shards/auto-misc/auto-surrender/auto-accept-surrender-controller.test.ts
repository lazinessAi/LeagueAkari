import { observable, reaction, runInAction } from 'mobx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoMiscMainContext } from '../context'
import { AutoMiscSettings } from '../state'
import { AutoAcceptSurrenderController } from './auto-accept-surrender-controller'
import { matchesSurrenderVoteTitle } from './match-message'
import { SurrenderOcrError, type SurrenderOcrResult } from './ocr-executor'
import { AutoSurrenderState } from './state'

const panel: SurrenderOcrResult = {
  text: '发 起 投 降',
  skipped: false,
  durationMs: 200
}
const absent = { ...panel, text: '' }

describe('surrender vote title matching', () => {
  it.each(['发起投降', '发 起 投 降', '发 起 投 的', '其他界面文字 发起投降 是 否'])(
    'recognizes the title without vote counts, bars, or colors: %s',
    (text) => {
      expect(matchesSurrenderVoteTitle(text)).toBe(true)
    }
  )
  it.each(['敌方军团同意投降', '投降失败', '正在发起进攻', '是 否'])(
    'ignores unrelated text: %s',
    (text) => {
      expect(matchesSurrenderVoteTitle(text)).toBe(false)
    }
  )
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createHarness(
  options: { enabled?: boolean; phase?: string; gameId?: number; available?: boolean } = {}
) {
  const settings = new AutoMiscSettings()
  settings.autoAcceptSurrenderEnabled = options.enabled ?? true
  const gameflow = observable({
    phase: options.phase ?? 'InProgress',
    session: { gameData: { gameId: options.gameId ?? 1 } }
  })
  const context = {
    settings,
    leagueClient: { data: { gameflow } },
    mobxUtils: { reaction },
    logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as AutoMiscMainContext
  const ocr = {
    start: vi.fn(async () => {}),
    scan: vi.fn(async () => panel),
    dispose: vi.fn()
  }
  const dependencies = {
    isAvailable: vi.fn(() => options.available ?? true),
    isGameForeground: vi.fn(async () => true),
    createOcr: vi.fn(() => ocr),
    sendSurrender: vi.fn(async (_signal: AbortSignal) => true)
  }
  const state = new AutoSurrenderState()
  const controller = new AutoAcceptSurrenderController(context, state, dependencies)
  controller.watch()
  return { settings, gameflow, ocr, dependencies, state, controller }
}

describe('automatic affirmative surrender vote', () => {
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
    { gameId: 0 },
    { available: false }
  ])('does not capture or send when unavailable: %j', async (options) => {
    harness = createHarness(options)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.createOcr).not.toHaveBeenCalled()
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('votes on the first panel and consumes it across repeated frames, setting edits, and toggles', async () => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.status).toBe('triggered')
    runInAction(() => {
      harness!.settings.autoAcceptSurrenderEnabled = false
    })
    runInAction(() => {
      harness!.settings.autoAcceptSurrenderRegion = { x: 40, y: 40, width: 60, height: 60 }
    })
    runInAction(() => {
      harness!.settings.autoAcceptSurrenderEnabled = true
    })
    await vi.advanceTimersByTimeAsync(58_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it('rearms only after more than one minute even if the title never disappears', async () => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(3)
  })

  it('can accept the next vote after a minute without first observing an absent title', async () => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(0)
    harness.ocr.scan.mockResolvedValue({ ...panel, skipped: true })
    await vi.advanceTimersByTimeAsync(61_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    harness.ocr.scan.mockResolvedValue(panel)
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
  })

  it('does not send without a matching title after the interval expires', async () => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(0)
    harness.ocr.scan.mockResolvedValue(absent)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.status).toBe('watching')
  })

  it.each([
    { ...panel, text: '队友投降失败' },
    { ...panel, skipped: true }
  ])('ignores unmatched or skipped frames: %j', async (frame) => {
    harness = createHarness()
    harness.ocr.scan.mockResolvedValue(frame)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('waits for game foreground before consuming the vote', async () => {
    harness = createHarness()
    harness.dependencies.isGameForeground.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    harness.dependencies.isGameForeground.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it('does not retry failed input on the same panel', async () => {
    harness = createHarness()
    harness.dependencies.sendSurrender.mockRejectedValue(new Error('input failed'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.error).toBe('send-failed')
  })

  it.each(['disable', 'end', 'new-game', 'region', 'dispose'] as const)(
    'discards in-flight OCR after %s',
    async (change) => {
      harness = createHarness()
      const frame = deferred<SurrenderOcrResult>()
      harness.ocr.scan.mockImplementationOnce(() => frame.promise)
      await vi.advanceTimersByTimeAsync(1000)
      // Subsequent generations receive no panel; only the abandoned frame has one.
      harness.ocr.scan.mockResolvedValue(absent)
      runInAction(() => {
        if (change === 'disable') harness!.settings.autoAcceptSurrenderEnabled = false
        if (change === 'end') harness!.gameflow.phase = 'EndOfGame'
        if (change === 'new-game') harness!.gameflow.session.gameData.gameId = 2
        if (change === 'region')
          harness!.settings.autoAcceptSurrenderRegion = { x: 0, y: 0, width: 50, height: 50 }
        if (change === 'dispose') harness!.controller.dispose()
      })
      frame.resolve(panel)
      await vi.advanceTimersByTimeAsync(1000)
      expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    }
  )

  it('aborts pending input on disable without sending again on reenable', async () => {
    harness = createHarness()
    const sending = deferred<boolean>()
    harness.dependencies.sendSurrender.mockImplementation(() => sending.promise)
    await vi.advanceTimersByTimeAsync(0)
    const signal = harness.dependencies.sendSurrender.mock.calls[0][0]
    runInAction(() => {
      harness!.settings.autoAcceptSurrenderEnabled = false
    })
    expect(signal.aborted).toBe(true)
    sending.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.status).toBe('idle')
    runInAction(() => {
      harness!.settings.autoAcceptSurrenderEnabled = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it('arms immediately for a new game', async () => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(0)
    runInAction(() => {
      harness!.gameflow.session.gameData.gameId = 2
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
  })

  it('stops on OCR errors and reports the reason', async () => {
    harness = createHarness()
    harness.ocr.scan.mockRejectedValue(new SurrenderOcrError('ocr-timeout'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.state.error).toBe('ocr-timeout')
    expect(harness.ocr.dispose).toHaveBeenCalled()
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })
})
