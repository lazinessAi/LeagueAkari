import { i18next } from '@main/i18n'
import { compareStructural, computed } from 'mobx'

import type { AutoSelectActionExecutor } from './action-executor'
import type { AutoSelectMainContext } from './context'
import type { AutoSelectLocalMessageService } from './local-message-service'

/** Akari 执行 decline 标记的有效期，超过后不再用于区分玩家的手动拒绝 */
const OWN_DECLINE_MARK_TTL_MS = 30_000

export class AutoSelectTradeController {
  /** Akari 执行过 decline 的 tradeId -> 标记时间，用于区分玩家的手动拒绝 */
  private _ownDeclinedTradeIds = new Map<number, number>()

  constructor(
    private readonly _context: AutoSelectMainContext,
    private readonly _localMessage: AutoSelectLocalMessageService,
    private readonly _actionExecutor: AutoSelectActionExecutor
  ) {}

  watch() {
    const { mobxUtils, state } = this._context

    // 选人阶段结束后清空本场的手动拒绝记录，下一场重新计算
    mobxUtils.reaction(
      () => state.inChampSelect,
      (inChampSelect) => {
        if (!inChampSelect) {
          state.setDeclinedChampionSwapSummonerIds([])
          this._ownDeclinedTradeIds.clear()
        }
      },
      { fireImmediately: true }
    )

    /** 记录玩家**手动**拒绝过的队友，供同场选人内自动拒绝其后续请求 */
    mobxUtils.reaction(
      () => state.ongoingChampionSwap,
      (trade, previousTrade) => {
        if (!trade) {
          this._ownDeclinedTradeIds.clear()
          return
        }

        // 仅识别同一请求的状态流转（如 RECEIVED -> DECLINED）
        if (!previousTrade || previousTrade.id !== trade.id) {
          return
        }

        if (previousTrade.state === 'DECLINED' || trade.state !== 'DECLINED') {
          return
        }

        // 发起方是本地玩家时 DECLINED 表示对方拒绝了，与玩家的主动拒绝无关
        if (trade.initiatedByLocalPlayer) {
          return
        }

        // Akari 自己执行的 decline 不视为玩家的主动拒绝
        if (this._consumeOwnDeclinedTrade(trade.id)) {
          return
        }

        const pickConfig = state.activeGroupConfig

        if (!pickConfig?.pick.autoDeclineRepeatedChampionSwapEnabled) {
          return
        }

        const requester = state.myTeam?.find(
          (member) => member.championId === trade.requesterChampionId
        )

        if (!requester) {
          return
        }

        if (!state.declinedChampionSwapSummonerIds.includes(requester.summonerId)) {
          state.setDeclinedChampionSwapSummonerIds([
            ...state.declinedChampionSwapSummonerIds,
            requester.summonerId
          ])
        }
      },
      { fireImmediately: true }
    )

    /** 记录其可用的时间，在没有基准的时候手动提供基准 */
    mobxUtils.reaction(
      () => state.ongoingChampionSwap,
      (trade, previousTrade) => {
        // 仅在第一次**收到** trade 时，记录其可用的时间
        if (!previousTrade && trade && trade.state === 'RECEIVED') {
          state.setOngoingChampionSwapCreatedAt(Date.now())
          return
        }

        state.setOngoingChampionSwapCreatedAt(null)
      },
      { fireImmediately: true }
    )

    const championSwapContext = computed(
      () => {
        if (!state.ongoingChampionSwapCreatedAt || !state.myTeamSlotChampions.length) {
          return null
        }

        const pickConfig = state.activeGroupConfig

        if (!pickConfig || !state.ongoingChampionSwap || !state.ongoingChampionSwapCreatedAt) {
          return null
        }

        const tradeId = state.ongoingChampionSwap.id
        const herChampionId = state.ongoingChampionSwap.requesterChampionId

        // 同场选人内自动拒绝: 玩家已手动拒绝过的队友再次发来请求时立即拒绝,
        // 体现玩家明确的拒绝意图, 优先于好友信任与自动处理策略
        if (pickConfig.pick.autoDeclineRepeatedChampionSwapEnabled) {
          const requester = state.myTeam?.find((member) => member.championId === herChampionId)

          if (requester && state.declinedChampionSwapSummonerIds.includes(requester.summonerId)) {
            return {
              action: 'decline',
              delayMs: 0,
              requesterChampionId: herChampionId,
              tradeId: tradeId,
              fromFriend: false,
              fromRepeatedDecline: true,
              requesterName: `${requester.gameName} #${requester.tagLine}`
            }
          }
        }

        // 好友信任覆盖: 无条件立即接受来自白名单好友的英雄交换,
        // 独立于 benchHandleTradeEnabled, 且不依赖期望英雄列表。
        // 发起人身份通过 requesterChampionId 在 myTeam 中定位 (大乱斗英雄唯一)。
        if (
          pickConfig.pick.acceptChampionSwapFromFriendsEnabled &&
          pickConfig.pick.championSwapFriendWhitelist.length > 0
        ) {
          const requester = state.myTeam?.find((member) => member.championId === herChampionId)

          const friend = requester
            ? pickConfig.pick.championSwapFriendWhitelist.find(
                (entry) => entry.summonerId === requester.summonerId
              )
            : undefined

          if (friend) {
            return {
              action: 'accept',
              delayMs: 0,
              requesterChampionId: herChampionId,
              tradeId: tradeId,
              fromFriend: true,
              fromRepeatedDecline: false,
              requesterName: friend.name
            }
          }
        }

        const expected = state.expectedSwaps

        if (!pickConfig.pick.benchHandleTradeEnabled || !expected) {
          return null
        }

        const delayMs =
          pickConfig.pick.delaySeconds * 1e3 - (Date.now() - state.ongoingChampionSwapCreatedAt)

        const timeLeft =
          state.inFinalizationPhase && state.correctedTimer
            ? state.correctedTimer.remainingMs
            : Infinity

        const herIndex = expected.findIndex((champion) => champion.id === herChampionId)

        if (herIndex === -1) {
          return {
            action: 'decline',
            delayMs: Math.min(delayMs, timeLeft),
            requesterChampionId: herChampionId,
            tradeId: tradeId,
            fromFriend: false,
            fromRepeatedDecline: false
          }
        }

        const handIndex = expected.findIndex(
          (champion) => champion.id === state.currentSessionChampionId
        )

        if (
          handIndex === -1 ||
          (pickConfig.pick.benchSelectFirstAvailableChampion && herIndex < handIndex)
        ) {
          return {
            action: 'accept',
            delayMs: Math.min(timeLeft, Math.max(0, delayMs)),
            requesterChampionId: herChampionId,
            tradeId: tradeId,
            fromFriend: false,
            fromRepeatedDecline: false
          }
        }

        return {
          action: 'decline',
          delayMs: Math.min(timeLeft, Math.max(0, delayMs)),
          requesterChampionId: herChampionId,
          tradeId: tradeId,
          fromFriend: false,
          fromRepeatedDecline: false
        }
      },
      { equals: compareStructural }
    )

    // --- trade: champion swap ---
    mobxUtils.reaction(
      () => championSwapContext.get(),
      (context) => {
        if (!context) {
          if (state.delayedChampionSwapTask) {
            clearTimeout(state.delayedChampionSwapTask.timerId)
            state.setDelayedChampionSwap(null)
          }

          return
        }

        if (state.delayedChampionSwapTask) {
          clearTimeout(state.delayedChampionSwapTask.timerId)
        }

        const { action, delayMs, requesterChampionId, tradeId } = context

        if (
          !state.delayedChampionSwapTask ||
          state.delayedChampionSwapTask.action !== action ||
          state.delayedChampionSwapTask.tradeId !== tradeId ||
          state.delayedChampionSwapTask.requesterChampionId !== requesterChampionId
        ) {
          if (context.fromFriend) {
            this._localMessage.send(
              i18next.t('auto-select-main.accept-champion-swap-from-friend', {
                name: context.requesterName,
                champion: this._actionExecutor.championNameWithId(requesterChampionId)
              })
            )
          } else if (context.fromRepeatedDecline) {
            this._localMessage.send(
              i18next.t('auto-select-main.auto-decline-repeated-champion-swap', {
                name: context.requesterName,
                champion: this._actionExecutor.championNameWithId(requesterChampionId)
              })
            )
          } else {
            this._localMessage.send(
              i18next.t(`auto-select-main.${action}-champion-swap`, {
                seconds: (delayMs / 1e3).toFixed(1),
                champion: this._actionExecutor.championNameWithId(requesterChampionId)
              })
            )
          }
        }

        if (action === 'accept') {
          state.setDelayedChampionSwap({
            action,
            tradeId: tradeId,
            delayMs,
            finishAt: Date.now() + delayMs,
            startAt: state.delayedChampionSwap?.startAt ?? Date.now(),
            requesterChampionId: requesterChampionId,
            timerId: setTimeout(
              () =>
                this._actionExecutor
                  .acceptChampionSwap(tradeId)
                  .finally(() => state.setDelayedChampionSwap(null)),
              delayMs
            )
          })
        } else if (action === 'decline') {
          state.setDelayedChampionSwap({
            action,
            tradeId: tradeId,
            delayMs,
            finishAt: Date.now() + delayMs,
            startAt: state.delayedChampionSwap?.startAt ?? Date.now(),
            requesterChampionId: requesterChampionId,
            timerId: setTimeout(
              () =>
                this._declineChampionSwap(tradeId).finally(() =>
                  state.setDelayedChampionSwap(null)
                ),
              delayMs
            )
          })
        } else {
          state.setDelayedChampionSwap(null)
        }
      },
      { fireImmediately: true }
    )
  }

  /** 由 Akari 执行的拒绝，标记 tradeId 以便与玩家的手动拒绝区分 */
  private _declineChampionSwap(tradeId: number) {
    this._ownDeclinedTradeIds.set(tradeId, Date.now())
    return this._actionExecutor.declineChampionSwap(tradeId)
  }

  /** 若该 tradeId 由 Akari 拒绝过（标记未过期）则消费掉标记并返回 true */
  private _consumeOwnDeclinedTrade(tradeId: number) {
    const markedAt = this._ownDeclinedTradeIds.get(tradeId)
    if (markedAt === undefined) {
      return false
    }

    this._ownDeclinedTradeIds.delete(tradeId)

    return Date.now() - markedAt <= OWN_DECLINE_MARK_TTL_MS
  }
}
