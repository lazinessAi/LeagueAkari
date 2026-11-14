import { AUTO_SURRENDER_GAME_PHASES } from '@shared/shards/auto-misc/auto-surrender'
import { compareStructural } from 'mobx'

import type { AutoMiscMainContext } from '../context'
import type { AutoSurrenderDependencies } from './auto-surrender-controller'
import { matchesSurrenderVoteTitle } from './match-message'
import { SurrenderOcrError } from './ocr-executor'
import type { AutoSurrenderState } from './state'

/** Attempts are consumed before input and separated by more than one minute. */
export class AutoAcceptSurrenderController {
  private _generation = 0
  private _gameId: number | null = null
  private _attemptedAt: number | null = null
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
        gameId: this._currentGameId,
        region: { ...this._context.settings.autoAcceptSurrenderRegion }
      }),
      () => {
        this._stop()
        if (this._currentGameId !== null && this._currentGameId !== this._gameId) {
          this._gameId = this._currentGameId
          this._attemptedAt = null
        }
        this._state.update({ status: 'idle', error: null })
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

  private get _currentGameId() {
    return this._context.leagueClient.data.gameflow.session?.gameData.gameId ?? null
  }

  private _canMonitor() {
    return (
      this._context.settings.autoAcceptSurrenderEnabled &&
      AUTO_SURRENDER_GAME_PHASES.some(
        (phase) => phase === this._context.leagueClient.data.gameflow.phase
      ) &&
      this._currentGameId !== null &&
      this._currentGameId > 0
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
      const result = await this._ocr!.scan(this._context.settings.autoAcceptSurrenderRegion, 'vote')
      if (!this._isCurrent(generation)) return
      const panelVisible = !result.skipped && matchesSurrenderVoteTitle(result.text)
      if (this._attemptedAt !== null && Date.now() - this._attemptedAt > 60_000) {
        this._attemptedAt = null
        this._state.update({ error: null })
      }
      this._state.update({
        status: result.skipped ? 'paused' : this._attemptedAt !== null ? 'triggered' : 'watching',
        lastText: result.skipped ? this._state.lastText : result.text,
        lastScanDurationMs: result.skipped ? this._state.lastScanDurationMs : result.durationMs
      })
      if (panelVisible && this._attemptedAt === null) {
        const foreground = await this._dependencies.isGameForeground()
        if (!this._isCurrent(generation)) return
        if (foreground) {
          this._attemptedAt = Date.now()
          this._context.logger.info('Surrender vote panel detected; voting yes', {
            gameId: this._gameId,
            scanDurationMs: result.durationMs
          })
          let sent = false
          try {
            sent = await this._dependencies.sendSurrender(this._abort!.signal)
          } catch (error) {
            this._context.logger.warn('Auto accept surrender input failed', error)
          }
          if (!this._isCurrent(generation)) return
          this._state.update({ status: 'triggered', error: sent ? null : 'send-failed' })
        } else {
          this._state.update({ status: 'paused' })
        }
      }
      if (this._isCurrent(generation)) {
        this._timer = setTimeout(() => void this._scan(generation), 250)
      }
    } catch (error) {
      this._fail(generation, error)
    }
  }

  private _fail(generation: number, error: unknown) {
    if (!this._isCurrent(generation)) return
    this._context.logger.warn('Auto accept surrender stopped', error)
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
