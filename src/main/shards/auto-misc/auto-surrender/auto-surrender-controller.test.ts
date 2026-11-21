import { observable, reaction, runInAction } from 'mobx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoMiscMainContext } from '../context'
import { AutoMiscSettings } from '../state'
import { AutoSurrenderController } from './auto-surrender-controller'
import {
  matchesSurrenderMessage,
  matchesSurrenderSelection,
  matchesSurrenderVoteTitle
} from './match-message'
import {
  SurrenderOcrError,
  type SurrenderOcrRegions,
  type SurrenderOcrResult
} from './ocr-executor'
import { AutoSurrenderState } from './state'

const blank = { text: '', skipped: false, durationMs: 100 }
const announcement = { ...blank, text: '蓝 色 军 团 同 意 投 降 ! 4 票 赞 成 , 0 票 反 对 。' }
const panel = { ...blank, text: '发 起 投 降 是 否' }
const selected = { ...blank, text: '你 选 择 了 是' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createHarness(
  options: { enabled?: boolean; phase?: string; available?: boolean; noSession?: boolean } = {}
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
  const frames = { chat: blank, panel: blank }
  const ocr = {
    start: vi.fn(async () => {}),
    scan: vi.fn(async (_regions: SurrenderOcrRegions): Promise<SurrenderOcrResult> => ({
      chatText: frames.chat.text,
      panelText: frames.panel.text,
      skipped: frames.chat.skipped || frames.panel.skipped,
      durationMs: frames.chat.durationMs + frames.panel.durationMs
    })),
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
  return { settings, gameflow, frames, ocr, dependencies, state, controller }
}

describe('surrender text recognition', () => {
  it.each(['敌方军团同意投降！4票赞成，0票反对。', '蓝 色 军 团 同 意 投 降', '我方军团同意投降'])(
    'matches surrender announcements: %s',
    (text) => {
      expect(matchesSurrenderMessage(text)).toBe(true)
    }
  )
  it.each(['军团正在向胜利迈进', '投降失败', '发起投降'])('ignores unrelated chat: %s', (text) => {
    expect(matchesSurrenderMessage(text)).toBe(false)
  })
  it.each(['发起投降', '发 起 投 的', '发起投降 是 否'])(
    'matches vote titles without colors: %s',
    (text) => {
      expect(matchesSurrenderVoteTitle(text)).toBe(true)
    }
  )
  it.each(['你选择是', '你 选 择 了 否', '你选择：赞成'])(
    'recognizes an already recorded vote: %s',
    (text) => {
      expect(matchesSurrenderSelection(text)).toBe(true)
    }
  )
  it.each(['发起投降 是 否', '选择英雄', '敌方军团同意投降'])(
    'does not infer a vote from unrelated text: %s',
    (text) => {
      expect(matchesSurrenderSelection(text)).toBe(false)
    }
  )
})

describe('unified surrender automation with screen confirmation', () => {
  let harness: ReturnType<typeof createHarness> | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
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
  ])('does not start OCR or input when unavailable: %j', async (options) => {
    harness = createHarness(options)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.dependencies.createOcr).not.toHaveBeenCalled()
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('requests both configured regions together and uses the paired recognition and duration', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.ocr.scan).toHaveBeenCalledExactlyOnceWith({
      chat: harness.settings.autoSurrenderRegion,
      panel: harness.settings.autoAcceptSurrenderRegion
    })
    expect(harness.state.lastText).toBe(`${announcement.text}\n${selected.text}`)
    expect(harness.state.lastScanDurationMs).toBe(200)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.ocr.scan).toHaveBeenCalledTimes(2)
  })

  it('starts on the first announcement and confirms initiation from a later panel frame', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.status).toBe('retrying')
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(10_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.status).toBe('triggered')
    expect(harness.state.followAttempts).toBe(1)
  })

  it('retries initiation until a vote panel appears even if native input reports success', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(1500)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(10_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    expect(harness.state.status).toBe('triggered')
  })

  it('waits between attempts and stops at five without confirmation, including after toggling', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(1499)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)
    expect(harness.state.followAttempts).toBe(5)
    expect(harness.state.status).toBe('exhausted')
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = false
    })
    runInAction(() => {
      harness!.settings.autoSurrenderEnabled = true
    })
    await vi.advanceTimersByTimeAsync(70_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)
  })

  it('keeps following when the triggering message scrolls away during retries', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(0)
    harness.frames.chat = blank
    await vi.advanceTimersByTimeAsync(1500)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
  })

  it('accepts a teammate vote and stops only after recognizing the recorded choice', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(1500)
    expect(harness.state.acceptAttempts).toBe(2)
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(10_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    expect(harness.state.status).toBe('triggered')
  })

  it('limits unconfirmed acceptance to five and checks the final attempt for late success', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)
    expect(harness.state.acceptAttempts).toBe(5)
    expect(harness.state.error).toBe('attempts-exhausted')
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.state.error).toBeNull()
    expect(harness.state.status).toBe('triggered')
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)
  })

  it('counts failed input toward the same five-attempt cap', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    harness.dependencies.sendSurrender.mockRejectedValue(new Error('input failed'))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)
    expect(harness.state.status).toBe('exhausted')
  })

  it('gets a fresh acceptance budget after an exhausted vote has disappeared', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.state.acceptAttempts).toBe(5)
    harness.frames.panel = blank
    await vi.advanceTimersByTimeAsync(4000)
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.state.acceptAttempts).toBe(1)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(6)
  })

  it('does not send for a vote the player has already answered, even if OCR briefly loses the choice', async () => {
    harness = createHarness()
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(0)
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(10_000)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('pauses acceptance retries when the panel disappears and handles a later new vote', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(0)
    harness.frames.panel = blank
    await vi.advanceTimersByTimeAsync(4000)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(2)
    expect(harness.state.acceptAttempts).toBe(1)
  })

  it('can follow another announcement in the same game after the old message is gone', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    harness.frames.panel = selected
    await vi.advanceTimersByTimeAsync(0)
    harness.frames.chat = blank
    harness.frames.panel = blank
    await vi.advanceTimersByTimeAsync(4000)
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    expect(harness.state.followAttempts).toBe(1)
  })

  it('gives an existing vote priority when both regions match, with independent five-attempt budgets', async () => {
    harness = createHarness()
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(1500)
    expect(harness.state.followAttempts).toBe(2)
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.state.followAttempts).toBe(2)
    expect(harness.state.acceptAttempts).toBe(5)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(7)
  })

  it('never overlaps OCR requests or consumes attempts from skipped frames', async () => {
    harness = createHarness()
    const frame = deferred<SurrenderOcrResult>()
    harness.ocr.scan.mockImplementationOnce(() => frame.promise)
    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.ocr.scan).toHaveBeenCalledTimes(1)
    frame.resolve({ chatText: '', panelText: panel.text, skipped: true, durationMs: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.status).toBe('paused')
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })

  it('waits for foreground and does not use background time as proof of a new vote', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    harness.dependencies.isGameForeground.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    harness.dependencies.isGameForeground.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
    harness.frames.panel = { ...blank, skipped: true }
    await vi.advanceTimersByTimeAsync(10_000)
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.state.acceptAttempts).toBe(2)
  })

  it.each(['disable', 'end', 'new-game', 'region', 'dispose'] as const)(
    'discards pending OCR after %s',
    async (change) => {
      harness = createHarness()
      const frame = deferred<SurrenderOcrResult>()
      harness.ocr.scan.mockImplementationOnce(() => frame.promise)
      await vi.advanceTimersByTimeAsync(0)
      runInAction(() => {
        if (change === 'disable') harness!.settings.autoSurrenderEnabled = false
        if (change === 'end') harness!.gameflow.phase = 'EndOfGame'
        if (change === 'new-game') harness!.gameflow.session!.gameData.gameId = 2
        if (change === 'region')
          harness!.settings.autoAcceptSurrenderRegion = { x: 0, y: 0, width: 50, height: 50 }
        if (change === 'dispose') harness!.controller.dispose()
      })
      frame.resolve({ chatText: '', panelText: panel.text, skipped: false, durationMs: 100 })
      await vi.advanceTimersByTimeAsync(1000)
      expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
    }
  )

  it('aborts pending input on disable and preserves the consumed attempt', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    const sending = deferred<boolean>()
    harness.dependencies.sendSurrender.mockImplementationOnce(() => sending.promise)
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
    await vi.advanceTimersByTimeAsync(1500)
    expect(harness.state.acceptAttempts).toBe(2)
  })

  it('starts a fresh budget in a new game', async () => {
    harness = createHarness()
    harness.frames.panel = panel
    await vi.advanceTimersByTimeAsync(20_000)
    runInAction(() => {
      harness!.gameflow.session!.gameData.gameId = 2
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.acceptAttempts).toBe(1)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(6)
  })

  it.each(['follow', 'accept'] as const)(
    'restarts %s after a complete end, lobby, champion select and next-game cycle',
    async (kind) => {
      harness = createHarness()
      if (kind === 'follow') harness.frames.chat = announcement
      else harness.frames.panel = panel
      await vi.advanceTimersByTimeAsync(20_000)
      expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)

      runInAction(() => {
        harness!.gameflow.phase = 'EndOfGame'
      })
      runInAction(() => {
        harness!.gameflow.phase = 'Lobby'
        harness!.gameflow.session = null
      })
      await vi.advanceTimersByTimeAsync(1000)
      runInAction(() => {
        harness!.gameflow.phase = 'ChampSelect'
        harness!.gameflow.session = { gameData: { gameId: 2 } }
      })
      runInAction(() => {
        harness!.gameflow.phase = 'GameStart'
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(5)

      runInAction(() => {
        harness!.gameflow.phase = 'InProgress'
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(harness.dependencies.createOcr).toHaveBeenCalledTimes(2)
      expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(6)
      expect(harness.state.followAttempts).toBe(kind === 'follow' ? 1 : 0)
      expect(harness.state.acceptAttempts).toBe(kind === 'accept' ? 1 : 0)
    }
  )

  it.each(['PreEndOfGame', 'WaitingForStats'])('keeps the warm worker during %s', async (phase) => {
    harness = createHarness()
    await vi.advanceTimersByTimeAsync(0)
    runInAction(() => {
      harness!.gameflow.phase = phase
    })
    harness.frames.chat = announcement
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.dependencies.createOcr).toHaveBeenCalledTimes(1)
    expect(harness.dependencies.sendSurrender).toHaveBeenCalledTimes(1)
  })

  it('reports an OCR error and stops the worker', async () => {
    harness = createHarness()
    harness.ocr.scan.mockRejectedValue(new SurrenderOcrError('ocr-timeout'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.state.error).toBe('ocr-timeout')
    expect(harness.ocr.dispose).toHaveBeenCalled()
    expect(harness.dependencies.sendSurrender).not.toHaveBeenCalled()
  })
})
