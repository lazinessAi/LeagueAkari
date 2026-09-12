import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import {
  type AiModelChatCompletionOptions,
  type AiModelChatMessage,
  type AiModelChatResult,
  type AiModelConfig,
  type AiModelFetchModelsResult,
  type AiModelTestResult
} from '@shared/shards/ai-model'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import {
  AI_MODEL_MAIN_NAMESPACE,
  AI_MODEL_RENDERER_NAMESPACE,
  type AiModelRendererContext
} from './context'
import { syncAiModelSettings } from './settings-sync'

@Shard(AiModelRenderer.id)
export class AiModelRenderer implements IAkariShardInitDispose {
  static id = AI_MODEL_RENDERER_NAMESPACE

  private readonly _context: AiModelRendererContext

  constructor(
    @Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) private readonly _settingUtils: SettingUtilsRenderer
  ) {
    this._context = {
      ipc: this._ipc,
      piniaMobxUtils,
      settingUtils: this._settingUtils
    }
  }

  async onInit() {
    await syncAiModelSettings(this._context)
  }

  /** 整体保存模型配置列表（新增/编辑/删除都通过替换整个列表完成） */
  setConfigs(configs: AiModelConfig[]) {
    return this._settingUtils.set(AI_MODEL_MAIN_NAMESPACE, 'configs', configs)
  }

  setActiveConfigId(id: string | null) {
    return this._settingUtils.set(AI_MODEL_MAIN_NAMESPACE, 'activeConfigId', id)
  }

  fetchModelList(config: AiModelConfig) {
    return this._ipc.call<AiModelFetchModelsResult>(
      AI_MODEL_MAIN_NAMESPACE,
      'fetchModelList',
      config
    )
  }

  testConfig(config: AiModelConfig) {
    return this._ipc.call<AiModelTestResult>(AI_MODEL_MAIN_NAMESPACE, 'testConfig', config)
  }

  /** 正式对话补全，主进程侧使用当前"使用中"的模型配置 */
  chatCompletion(messages: AiModelChatMessage[], options?: AiModelChatCompletionOptions) {
    return this._ipc.call<AiModelChatResult>(
      AI_MODEL_MAIN_NAMESPACE,
      'chatCompletion',
      messages,
      options
    )
  }
}
