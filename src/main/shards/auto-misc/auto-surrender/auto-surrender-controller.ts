import {
  AUTO_SURRENDER_GAME_PHASES,
  type AutoSurrenderError
} from '@shared/shards/auto-misc/auto-surrender'
import { compareStructural } from 'mobx'

import type { AutoMiscMainContext } from '../context'
import { matchesSurrenderMessage } from './match-message'
import { SurrenderOcrError, type SurrenderOcrExecutor } from './ocr-executor'
import type { AutoSurrenderState } from './state'

interface AutoSurrenderDependencies {
  isAvailable(): boolean
  isGameForeground(): Promise<boolean>
  createOcr(): Pick<SurrenderOcrExecutor, 'start' | 'scan' | 'dispose'>
  sendSurrender(signal: AbortSignal): Promise<boolean>
}

export class AutoSurrenderController {
  private _generation = 0
  private _attemptedGameId: number | null = null
  private _attemptedCaptureId: string | null = null
  private _attemptError: AutoSurrenderError | null = null
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
        alwaysCheck: this._context.settings.autoSurrenderAlwaysCheck,
        gameId: this._context.settings.autoSurrenderAlwaysCheck ? null : this._gameId,
        region: { ...this._context.settings.autoSurrenderRegion }
      }),
      () => {
        this._stop()
        this._state.update({ status: 'idle', error: null })
        if (!this._canMonitor()) return
        if (!this._context.settings.autoSurrenderAlwaysCheck && this._hasAttempted(null)) {
          this._state.update({
            status: this._attemptError ? 'error' : 'triggered',
            error: this._attemptError
          })
          return
        }
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
      (this._context.settings.autoSurrenderAlwaysCheck ||
        (AUTO_SURRENDER_GAME_PHASES.some(
          (phase) => phase === this._context.leagueClient.data.gameflow.phase
        ) &&
          this._gameId !== null &&
          this._gameId > 0))
    )
  }

  private _hasAttempted(captureId: string | null) {
    return (
      (captureId !== null && captureId === this._attemptedCaptureId) ||
      (!this._context.settings.autoSurrenderAlwaysCheck &&
        this._gameId !== null &&
        this._gameId === this._attemptedGameId)
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
      const result = await this._ocr!.scan(this._context.settings.autoSurrenderRegion)
      if (!this._isCurrent(generation)) return
      const attempted = !result.skipped && this._hasAttempted(result.captureId)
      this._state.update({
        status: result.skipped
          ? 'paused'
          : attempted
            ? this._attemptError
              ? 'error'
              : 'triggered'
            : 'watching',
        error: attempted ? this._attemptError : null,
        lastText: result.skipped ? this._state.lastText : result.text,
        lastScanDurationMs: result.skipped ? this._state.lastScanDurationMs : result.durationMs
      })
      if (!result.skipped && !attempted && matchesSurrenderMessage(result.text)) {
        const foreground = await this._dependencies.isGameForeground()
        if (!this._isCurrent(generation)) return
        if (foreground) {
          // Consume the game before awaiting input: duplicate OCR frames/toggle changes cannot resend.
          this._attemptedGameId = this._gameId
          this._attemptedCaptureId = result.captureId
          if (!this._context.settings.autoSurrenderAlwaysCheck) {
            this._ocr?.dispose()
            this._ocr = null
          }
          this._context.logger.info('Surrender message detected; sending /ff', {
            gameId: this._gameId,
            scanDurationMs: result.durationMs
          })
          let sent = false
          try {
            sent = await this._dependencies.sendSurrender(this._abort!.signal)
          } catch (error) {
            this._context.logger.warn('Auto surrender input failed', error)
          }
          if (!this._isCurrent(generation)) return
          this._attemptError = sent ? null : 'send-failed'
          this._state.update({
            status: sent ? 'triggered' : 'error',
            error: this._attemptError
          })
          if (!this._context.settings.autoSurrenderAlwaysCheck) return
        }
      }
      if (this._isCurrent(generation)) {
        // Sequential scans bound CPU usage and never build up a backlog of old frames.
        this._timer = setTimeout(() => void this._scan(generation), 150)
      }
    } catch (error) {
      this._fail(generation, error)
    }
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
  }
}
