import type { AutoSurrenderSnapshot } from '@shared/shards/auto-misc/auto-surrender'
import { makeAutoObservable } from 'mobx'

export class AutoSurrenderState implements AutoSurrenderSnapshot {
  status: AutoSurrenderSnapshot['status'] = 'idle'
  error: AutoSurrenderSnapshot['error'] = null
  lastText = ''
  lastScanDurationMs: number | null = null
  followAttempts = 0
  acceptAttempts = 0

  constructor() {
    makeAutoObservable(this)
  }

  update(snapshot: Partial<AutoSurrenderSnapshot>) {
    Object.assign(this, snapshot)
  }
}
