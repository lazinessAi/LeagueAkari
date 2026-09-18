import {
  IN_GAME_SEND_PRESET_TARGETS,
  type InGameSendPresetTarget,
  type InGameSendPresetTargetShortcuts,
  getInGameSendAiEvaluationShortcutTargetId,
  getInGameSendHorseGradeShortcutTargetId
} from '@shared/shards/in-game-send'

import { IN_GAME_SEND_MAIN_NAMESPACE, type InGameSendMainContext } from './context'

interface ShortcutGroup {
  shortcuts: InGameSendPresetTargetShortcuts
  getTargetId: (target: InGameSendPresetTarget) => string
  eventName: string
  settingKey: 'aiEvaluationTargetShortcuts' | 'horseGradeTargetShortcuts'
}

/**
 * 海斗评价 / 海斗马种评价的发送快捷键。
 *
 * 评价回复文本在渲染进程状态中，主进程无法直接发送，
 * 因此快捷键按下后仅向渲染进程广播事件，由渲染端执行发送。
 */
export class AiEvaluationShortcutController {
  constructor(private readonly _context: InGameSendMainContext) {}

  start() {
    const { mobxUtils, settings } = this._context

    mobxUtils.reaction(
      () => [settings.aiEvaluationTargetShortcuts, settings.horseGradeTargetShortcuts],
      () => {
        this._syncShortcuts()
      },
      { fireImmediately: true }
    )
  }

  private _syncShortcuts() {
    const { ipc, keyboardShortcuts, logger, settings, settingService } = this._context

    const groups: ShortcutGroup[] = [
      {
        shortcuts: settings.aiEvaluationTargetShortcuts,
        getTargetId: getInGameSendAiEvaluationShortcutTargetId,
        eventName: 'ai-evaluation-shortcut',
        settingKey: 'aiEvaluationTargetShortcuts'
      },
      {
        shortcuts: settings.horseGradeTargetShortcuts,
        getTargetId: getInGameSendHorseGradeShortcutTargetId,
        eventName: 'horse-grade-shortcut',
        settingKey: 'horseGradeTargetShortcuts'
      }
    ]

    for (const group of groups) {
      for (const target of IN_GAME_SEND_PRESET_TARGETS) {
        const targetId = group.getTargetId(target)
        const shortcut = group.shortcuts[target]

        if (!shortcut) {
          keyboardShortcuts.unregisterByTargetId(targetId)
          continue
        }

        try {
          keyboardShortcuts.register(targetId, shortcut, 'last-active', () => {
            ipc.sendEvent(IN_GAME_SEND_MAIN_NAMESPACE, group.eventName, target)
          })
        } catch (error) {
          logger.warn('Failed to register evaluation shortcut', targetId, error)
          void settingService.set(group.settingKey, {
            ...group.shortcuts,
            [target]: null
          })
        }
      }
    }
  }
}
