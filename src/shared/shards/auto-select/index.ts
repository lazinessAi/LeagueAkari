export type AutoPickBanStrategy = 'just-show' | 'show-and-lock-in' | 'lock-in-immediately'

export interface PositionChampion {
  default: number[]
  top: number[]
  jungle: number[]
  middle: number[]
  bottom: number[]
  utility: number[]
  [key: string]: number[]
}

export interface PickChampionConfig {
  enabled: boolean
  champions: PositionChampion
  delaySeconds: number
  ignoreIntent: boolean
  strategy: AutoPickBanStrategy
  showIntent: boolean

  // bench mode only
  benchSelectFirstAvailableChampion: boolean
  benchSwapAccumulatedDelaySeconds: number
  benchHandleTradeEnabled: boolean

  // bench mode only: 无条件接受来自指定好友的英雄交换
  acceptChampionSwapFromFriendsEnabled: boolean
  championSwapFriendWhitelist: ChampionSwapFriend[]

  // bench mode only: 自动拒绝本场选人中已手动拒绝过的队友的后续交换请求
  autoDeclineRepeatedChampionSwapEnabled: boolean
}

export interface ChampionSwapFriend {
  summonerId: number
  name: string
}

export interface BanChampionConfig {
  enabled: boolean
  champions: PositionChampion
  strategy: AutoPickBanStrategy
  delaySeconds: number
}

export interface DelayedBanPick {
  isPickIntent: boolean
  completed: boolean
  championId: number
  delayMs: number
  startAt: number
  finishAt: number
}

export interface DelayedBenchSwap {
  championId: number
  delayMs: number
  startAt: number
  finishAt: number
}

export interface DelayedChampionSwap {
  action: 'accept' | 'decline'
  tradeId: number
  delayMs: number
  startAt: number
  finishAt: number
  requesterChampionId: number
}

export interface ExpectedChampionStatus {
  id: number
  status: string
}
