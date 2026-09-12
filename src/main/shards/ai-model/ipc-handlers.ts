import type { AiModelConfig } from '@shared/shards/ai-model'

import { AI_MODEL_MAIN_NAMESPACE, type AiModelMainContext } from './context'
import type { AiModelRequestExecutor } from './model-request-executor'

/**
 * 暴露给渲染进程的 IPC 调用。配置的持久化读写走 settings（propSync + set），
 * 这里只承载两种一次性的模型请求：拉取模型列表与连通性测试。
 */
export class AiModelIpcHandlers {
  constructor(
    private readonly _context: AiModelMainContext,
    private readonly _requestExecutor: AiModelRequestExecutor
  ) {}

  register() {
    const { ipc } = this._context

    ipc.onCall(AI_MODEL_MAIN_NAMESPACE, 'fetchModelList', (_, config: AiModelConfig) => {
      return this._requestExecutor.fetchModelList(config)
    })

    ipc.onCall(AI_MODEL_MAIN_NAMESPACE, 'testConfig', (_, config: AiModelConfig) => {
      return this._requestExecutor.testConfig(config)
    })
  }
}
