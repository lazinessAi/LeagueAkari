import { SetupInAppScopeRenderer } from '@renderer-shared/shards/setup-in-app-scope'
import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'

import { PREVIOUS_GAME_RENDERER_NAMESPACE } from './context'
import { startPreviousGameController } from './controller'

/**
 * “上一局”视图的数据来源：
 * 自动拉取当前召唤师最近一局的对局数据，并以与“对局分析模拟”一致的
 * 快照形状（OngoingGameSnapshot）供对局面板纯展示。
 */
@Shard(PREVIOUS_GAME_RENDERER_NAMESPACE)
export class PreviousGameRenderer implements IAkariShardInitDispose {
  static id = PREVIOUS_GAME_RENDERER_NAMESPACE

  private _refresh: (() => Promise<{ ok: boolean }>) | null = null
  private _dispose: (() => void) | null = null

  constructor(
    @Dep(SetupInAppScopeRenderer) private readonly _setupInAppScope: SetupInAppScopeRenderer
  ) {
    this._setupInAppScope.addSetupFn(() => {
      const controller = startPreviousGameController()
      this._refresh = controller.refresh
      this._dispose = controller.dispose
    })
  }

  async onDispose() {
    this._dispose?.()
    this._refresh = null
    this._dispose = null
  }

  /** 手动刷新“上一局”数据 */
  refresh() {
    return this._refresh?.() ?? Promise.resolve({ ok: true })
  }
}
