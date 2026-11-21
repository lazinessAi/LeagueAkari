import type { AutoMiscRankedStatus } from '@shared/shards/auto-misc'
import {
  type AutoSurrenderSnapshot,
  DEFAULT_AUTO_ACCEPT_SURRENDER_REGION,
  DEFAULT_AUTO_SURRENDER_REGION
} from '@shared/shards/auto-misc/auto-surrender'
import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useAutoMiscStore = defineStore('shard:auto-misc-renderer', () => {
  const settings = shallowReactive({
    autoAcceptSurrenderRegion: { ...DEFAULT_AUTO_ACCEPT_SURRENDER_REGION },
    autoSurrenderEnabled: false,
    autoSurrenderRegion: { ...DEFAULT_AUTO_SURRENDER_REGION },
    autoReplyEnabled: false,
    autoReplyEnableOnAway: false,
    autoReplyText: '',
    lockOfflineStatus: false,
    autoSetStatusMessageEnabled: false,
    statusMessage: '',
    autoSetRankedStatusEnabled: false,
    rankedStatus: {
      queue: 'RANKED_SOLO_5x5',
      tier: 'CHALLENGER',
      division: 'I'
    } as AutoMiscRankedStatus
  })

  const autoSurrender = shallowReactive<AutoSurrenderSnapshot>({
    status: 'idle',
    error: null,
    lastText: '',
    lastScanDurationMs: null,
    followAttempts: 0,
    acceptAttempts: 0
  })

  return { settings, autoSurrender }
})
