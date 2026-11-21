import { AutoMiscRankedStatus } from '@shared/shards/auto-misc'
import {
  DEFAULT_AUTO_ACCEPT_SURRENDER_REGION,
  DEFAULT_AUTO_SURRENDER_REGION
} from '@shared/shards/auto-misc/auto-surrender'
import { makeAutoObservable } from 'mobx'

export class AutoMiscSettings {
  autoAcceptSurrenderRegion = { ...DEFAULT_AUTO_ACCEPT_SURRENDER_REGION }

  autoSurrenderEnabled = false
  autoSurrenderRegion = { ...DEFAULT_AUTO_SURRENDER_REGION }

  autoReplyEnabled = false
  autoReplyEnableOnAway = false
  autoReplyText = ''

  lockOfflineStatus = false

  autoSetStatusMessageEnabled = false
  statusMessage = ''

  autoSetRankedStatusEnabled = false
  rankedStatus: AutoMiscRankedStatus = {
    queue: 'RANKED_SOLO_5x5',
    tier: 'CHALLENGER',
    division: 'I'
  }

  constructor() {
    makeAutoObservable(this)
  }
}
