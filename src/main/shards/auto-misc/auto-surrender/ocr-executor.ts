import type {
  AutoSurrenderError,
  AutoSurrenderRegion
} from '@shared/shards/auto-misc/auto-surrender'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import workerScript from './ocr-worker.ps1?raw'

export interface SurrenderOcrResult {
  text: string
  durationMs: number
  skipped: boolean
}

export class SurrenderOcrError extends Error {
  constructor(public readonly code: AutoSurrenderError) {
    super(code)
  }
}

/** One persistent, hidden Windows OCR process; no shell/model startup on each frame. */
export class SurrenderOcrExecutor {
  private _process: ChildProcessWithoutNullStreams | null = null
  private _pending: {
    resolve: (value: SurrenderOcrResult) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  } | null = null
  private _sequence = 0

  start(): Promise<void> {
    if (process.platform !== 'win32') {
      return Promise.reject(new SurrenderOcrError('ocr-initialization-failed'))
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe'
        ),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(workerScript, 'utf16le').toString('base64')
        ],
        { windowsHide: true, stdio: 'pipe' }
      )
      this._process = child
      let ready = false
      const startupTimeout = setTimeout(() => {
        reject(new SurrenderOcrError('ocr-timeout'))
        this.dispose()
      }, 15000)
      const lines = createInterface({ input: child.stdout })
      // PowerShell can emit CLIXML diagnostics. Never retain frame data or log arbitrary stderr.
      child.stderr.resume()
      child.stdin.on('error', () => this._rejectPending('ocr-worker-exited'))
      lines.on('line', (line) => {
        let message: {
          type: 'ready' | 'result' | 'error'
          id?: number
          error?: AutoSurrenderError
        } & Partial<SurrenderOcrResult>
        try {
          message = JSON.parse(line)
        } catch {
          return
        }
        if (message.type === 'ready') {
          ready = true
          clearTimeout(startupTimeout)
          resolve()
        } else if (message.type === 'error') {
          if (!ready) {
            clearTimeout(startupTimeout)
            reject(new SurrenderOcrError(message.error || 'ocr-initialization-failed'))
            this.dispose()
          } else if (message.id === this._sequence) {
            this._rejectPending(message.error || 'ocr-scan-failed')
          }
        } else if (message.type === 'result' && message.id === this._sequence && this._pending) {
          const pending = this._pending
          this._pending = null
          clearTimeout(pending.timeout)
          pending.resolve({
            text: message.text ?? '',
            durationMs: message.durationMs ?? 0,
            skipped: message.skipped ?? false
          })
        }
      })
      const exited = () => {
        clearTimeout(startupTimeout)
        lines.close()
        if (!ready) reject(new SurrenderOcrError('ocr-worker-exited'))
        this._rejectPending('ocr-worker-exited')
        if (this._process === child) this._process = null
      }
      child.once('error', exited)
      child.once('exit', exited)
    })
  }

  scan(region: AutoSurrenderRegion): Promise<SurrenderOcrResult> {
    if (process.platform !== 'win32' || !this._process || this._process.exitCode !== null) {
      return Promise.reject(new SurrenderOcrError('ocr-worker-exited'))
    }
    if (this._pending) return Promise.reject(new SurrenderOcrError('ocr-scan-failed'))
    const child = this._process
    return new Promise((resolve, reject) => {
      this._pending = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this._rejectPending('ocr-timeout')
          this.dispose()
        }, 3000)
      }
      child.stdin.write(JSON.stringify({ id: ++this._sequence, region }) + '\n', (error) => {
        if (error) this._rejectPending('ocr-worker-exited')
      })
    })
  }

  dispose() {
    const child = this._process
    this._process = null
    this._rejectPending('ocr-worker-exited')
    child?.stdin.destroy()
    child?.kill()
  }

  private _rejectPending(code: AutoSurrenderError) {
    if (!this._pending) return
    const pending = this._pending
    this._pending = null
    clearTimeout(pending.timeout)
    pending.reject(new SurrenderOcrError(code))
  }
}
