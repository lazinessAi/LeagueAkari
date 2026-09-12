import type {
  AiModelChatCompletionOptions,
  AiModelChatMessage,
  AiModelChatResult,
  AiModelConfig
} from '@shared/shards/ai-model'

import { AI_MODEL_MAIN_NAMESPACE, type AiModelMainContext } from './context'
import type { AiModelRequestExecutor } from './model-request-executor'

/**
 * 暴露给渲染进程的 IPC 调用。配置的持久化读写走 settings（propSync + set），
 * 这里只承载模型相关的请求：拉取模型列表、连通性测试与正式的对话补全。
 */
export class AiModelIpcHandlers {
  constructor(
    private readonly _context: AiModelMainContext,
    private readonly _requestExecutor: AiModelRequestExecutor
  ) {}

  register() {
    const { ipc, settings } = this._context

    ipc.onCall(AI_MODEL_MAIN_NAMESPACE, 'fetchModelList', (_, config: AiModelConfig) => {
      return this._requestExecutor.fetchModelList(config)
    })

    ipc.onCall(AI_MODEL_MAIN_NAMESPACE, 'testConfig', (_, config: AiModelConfig) => {
      return this._requestExecutor.testConfig(config)
    })

    // 正式对话补全固定使用当前"使用中"的模型配置
    ipc.onCall(
      AI_MODEL_MAIN_NAMESPACE,
      'chatCompletion',
      (_, messages: AiModelChatMessage[], options?: AiModelChatCompletionOptions) => {
        const activeConfig = settings.configs.find(
          (config) => config.id === settings.activeConfigId
        )

        if (!activeConfig) {
          const failure: AiModelChatResult = {
            ok: false,
            reason: 'no-active-config',
            message: 'no active model config'
          }
          return failure
        }

        return this._requestExecutor.chatCompletion(activeConfig, messages, options)
      }
    )
  }
}
