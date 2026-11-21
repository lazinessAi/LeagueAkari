import {
  AUTO_SURRENDER_GAME_PHASES,
  AUTO_SURRENDER_MAX_ATTEMPTS
} from '@shared/shards/auto-misc/auto-surrender'
import { compareStructural } from 'mobx'

import type { AutoMiscMainContext } from '../context'
import {
  matchesSurrenderMessage,
  matchesSurrenderSelection,
  matchesSurrenderVoteTitle
} from './match-message'
import { SurrenderOcrError, type SurrenderOcrExecutor } from './ocr-executor'
import type { AutoSurrenderState } from './state'

export interface AutoSurrenderDependencies {
  isAvailable(): boolean
  isGameForeground(): Promise<boolean>
  createOcr(): Pick<SurrenderOcrExecutor, 'start' | 'scan' | 'dispose'>
  sendSurrender(signal: AbortSignal): Promise<boolean>
}

interface SurrenderRound {
  attempts: number
  confirmed: boolean
  nextAttemptAt: number
}

const RETRY_DELAY_MS = 1500
const REARM_ABSENCE_MS = 3000

/** One worker and input flow coordinate initiation, voting, and screen confirmation. */
export class AutoSurrenderController {
  private _generation = 0
  private _currentGameId: number | null = null
  private _follow: SurrenderRound | null = null
  private _accept: SurrenderRound | null = null
  private _chatAbsentSince: number | null = null
  private _panelAbsentSince: number | null = null
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _ocr: ReturnType<AutoSurrenderDependencies['createOcr']> | null = null
  private _abort: AbortController | null = null
  private _unwatch: (() => void) | null = null

  constructor(
    private readonly _context: AutoMiscMainContext,
    private readonly _state: AutoSurrenderState,
    private readonly _dependencies: AutoSurrenderDependencies
  ) {}

  watch() {
    this._unwatch = this._context.mobxUtils.reaction(
      () => ({
        active: this._canMonitor(),
        gameId: this._gameId,
        chatRegion: { ...this._context.settings.autoSurrenderRegion },
        panelRegion: { ...this._context.settings.autoAcceptSurrenderRegion }
      }),
      () => {
        this._stop()
        if (this._gameId !== null && this._gameId !== this._currentGameId) {
          this._currentGameId = this._gameId
          this._follow = null
          this._accept = null
        }
        this._state.update({
          status: 'idle',
          error: null,
          followAttempts: this._follow?.attempts ?? 0,
          acceptAttempts: this._accept?.attempts ?? 0
        })
        if (!this._canMonitor()) return
        if (!this._dependencies.isAvailable()) {
          this._state.update({ status: 'unavailable', error: 'native-input-unavailable' })
          return
        }
        this._state.update({ status: 'starting', lastText: '', lastScanDurationMs: null })
        this._abort = new AbortController()
        void this._start(this._generation)
      },
      { fireImmediately: true, equals: compareStructural }
    )
  }

  dispose() {
    this._unwatch?.()
    this._unwatch = null
    this._stop()
  }

  private get _gameId() {
    return this._context.leagueClient.data.gameflow.session?.gameData.gameId ?? null
  }

  private _canMonitor() {
    return (
      this._context.settings.autoSurrenderEnabled &&
      AUTO_SURRENDER_GAME_PHASES.some(
        (phase) => phase === this._context.leagueClient.data.gameflow.phase
      ) &&
      this._gameId !== null &&
      this._gameId > 0
    )
  }

  private _isCurrent(generation: number) {
    return generation === this._generation && this._canMonitor() && !this._abort?.signal.aborted
  }

  private async _start(generation: number) {
    try {
      this._ocr = this._dependencies.createOcr()
      await this._ocr.start()
      if (this._isCurrent(generation)) await this._scan(generation)
    } catch (error) {
      this._fail(generation, error)
    }
  }

  private async _scan(generation: number) {
    if (!this._isCurrent(generation)) return
    try {
      const frame = await this._ocr!.scan({
        chat: this._context.settings.autoSurrenderRegion,
        panel: this._context.settings.autoAcceptSurrenderRegion
      })
      if (!this._isCurrent(generation)) return
      if (frame.skipped) {
        this._pause()
      } else {
        this._state.update({
          lastText: `${frame.chatText}\n${frame.panelText}`.trim(),
          lastScanDurationMs: frame.durationMs
        })
        const selected = matchesSurrenderSelection(frame.panelText)
        const panelVisible = selected || matchesSurrenderVoteTitle(frame.panelText)
        const announcement = matchesSurrenderMessage(frame.chatText)
        this._state.update({ status: 'watching' })
        this._observe(announcement, panelVisible, selected)
        // A visible vote takes priority; never let two automations compete for keyboard input.
        if (panelVisible) {
          if (!selected && this._accept && !this._accept.confirmed) {
            await this._attempt(this._accept, 'accept', generation)
          }
        } else if (this._follow && !this._follow.confirmed) {
          await this._attempt(this._follow, 'follow', generation)
        }
        if (!this._isCurrent(generation)) return
        this._updateStatus()
      }
      if (this._isCurrent(generation)) {
        this._timer = setTimeout(() => void this._scan(generation), 250)
      }
    } catch (error) {
      this._fail(generation, error)
    }
  }

  private _observe(announcement: boolean, panelVisible: boolean, selected: boolean) {
    const now = Date.now()
    if (announcement) {
      if (
        this._chatAbsentSince !== null &&
        now - this._chatAbsentSince >= REARM_ABSENCE_MS &&
        this._follow &&
        this._isFinished(this._follow)
      ) {
        this._follow = null
      }
      this._chatAbsentSince = null
      this._follow ??= { attempts: 0, confirmed: false, nextAttemptAt: 0 }
    } else {
      this._chatAbsentSince ??= now
    }
    if (panelVisible) {
      if (this._panelAbsentSince !== null && now - this._panelAbsentSince >= REARM_ABSENCE_MS) {
        this._accept = null
      }
      this._panelAbsentSince = null
      if (this._follow) this._follow.confirmed = true
      this._accept ??= { attempts: 0, confirmed: false, nextAttemptAt: 0 }
      if (selected) this._accept.confirmed = true
    } else {
      this._panelAbsentSince ??= now
    }
  }

  private async _attempt(round: SurrenderRound, kind: 'follow' | 'accept', generation: number) {
    if (round.attempts >= AUTO_SURRENDER_MAX_ATTEMPTS || Date.now() < round.nextAttemptAt) return
    const foreground = await this._dependencies.isGameForeground()
    if (!this._isCurrent(generation)) return
    if (!foreground) {
      this._pause()
      return
    }
    // Count before input, including failures/cancellation, so toggles cannot exceed the cap.
    round.attempts++
    this._state.update({
      followAttempts: this._follow?.attempts ?? 0,
      acceptAttempts: this._accept?.attempts ?? 0
    })
    this._context.logger.info('Automatic surrender attempt', {
      kind,
      attempt: round.attempts,
      gameId: this._gameId
    })
    try {
      await this._dependencies.sendSurrender(this._abort!.signal)
    } catch (error) {
      this._context.logger.warn('Automatic surrender input failed', error)
    } finally {
      // Native input success is not vote success; wait for a fresh panel recognition.
      round.nextAttemptAt = Date.now() + RETRY_DELAY_MS
    }
  }

  private _isFinished(round: SurrenderRound) {
    return (
      round.confirmed ||
      (round.attempts >= AUTO_SURRENDER_MAX_ATTEMPTS && Date.now() >= round.nextAttemptAt)
    )
  }

  private _updateStatus() {
    // Keep the foreground-loss status set by _attempt until the next valid frame.
    if (this._state.status === 'paused') return
    const rounds = [this._follow, this._accept].filter(
      (round): round is SurrenderRound => round !== null
    )
    const exhausted = rounds.some((round) => !round.confirmed && this._isFinished(round))
    const pending = rounds.some((round) => !this._isFinished(round))
    this._state.update({
      followAttempts: this._follow?.attempts ?? 0,
      acceptAttempts: this._accept?.attempts ?? 0,
      status: pending
        ? 'retrying'
        : exhausted
          ? 'exhausted'
          : rounds.length
            ? 'triggered'
            : 'watching',
      error: exhausted ? 'attempts-exhausted' : null
    })
  }

  private _pause() {
    this._chatAbsentSince = null
    this._panelAbsentSince = null
    this._state.update({ status: 'paused' })
  }

  private _fail(generation: number, error: unknown) {
    if (!this._isCurrent(generation)) return
    this._context.logger.warn('Auto surrender stopped', error)
    this._stop()
    this._state.update({
      status: 'error',
      error: error instanceof SurrenderOcrError ? error.code : 'ocr-scan-failed'
    })
  }

  private _stop() {
    this._generation++
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    this._abort?.abort()
    this._abort = null
    this._ocr?.dispose()
    this._ocr = null
    this._chatAbsentSince = null
    this._panelAbsentSince = null
  }
}
