import {
  IN_GAME_SEND_PRESET_TARGETS,
  getInGameSendAiEvaluationShortcutTargetId
} from '@shared/shards/in-game-send'

import { IN_GAME_SEND_MAIN_NAMESPACE, type InGameSendMainContext } from './context'

/**
 * AI 评价的发送快捷键。
 *
 * 评价回复文本在渲染进程状态中，主进程无法直接发送，
 * 因此快捷键按下后仅向渲染进程广播事件，由渲染端执行发送。
 */
export class AiEvaluationShortcutController {
  constructor(private readonly _context: InGameSendMainContext) {}

  start() {
    const { mobxUtils, settings } = this._context

    mobxUtils.reaction(
      () => settings.aiEvaluationTargetShortcuts,
      () => {
        this._syncShortcuts()
      },
      { fireImmediately: true }
    )
  }

  private _syncShortcuts() {
    const { ipc, keyboardShortcuts, logger, settings, settingService } = this._context

    for (const target of IN_GAME_SEND_PRESET_TARGETS) {
      const targetId = getInGameSendAiEvaluationShortcutTargetId(target)
      const shortcut = settings.aiEvaluationTargetShortcuts[target]

      if (!shortcut) {
        keyboardShortcuts.unregisterByTargetId(targetId)
        continue
      }

      try {
        keyboardShortcuts.register(targetId, shortcut, 'last-active', () => {
          ipc.sendEvent(IN_GAME_SEND_MAIN_NAMESPACE, 'ai-evaluation-shortcut', target)
        })
      } catch (error) {
        logger.warn('Failed to register AI evaluation shortcut', targetId, error)
        void settingService.set('aiEvaluationTargetShortcuts', {
          ...settings.aiEvaluationTargetShortcuts,
          [target]: null
        })
      }
    }
  }
}
