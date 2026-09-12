import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { AI_MODEL_REQUEST_TIMEOUT, normalizeAiModelConfigs } from '@shared/shards/ai-model'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { NetworkMain } from '../network'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { AI_MODEL_MAIN_NAMESPACE, type AiModelMainContext } from './context'
import { AiModelIpcHandlers } from './ipc-handlers'
import { AiModelRequestExecutor } from './model-request-executor'
import { aiModelConfigsSchema } from './setting-schemas'
import { AiModelSettings } from './state'

/**
 * AI 模型配置管理：
 *  - 持有多个模型配置（OpenAI 兼容 / Anthropic）与全局激活配置
 *  - 提供拉取模型列表与连通性测试的 IPC 调用
 *  - 为之后基于 AI 的功能提供统一的模型调用入口
 */
@Shard(AiModelMain.id)
export class AiModelMain implements IAkariShardInitDispose {
  static id = AI_MODEL_MAIN_NAMESPACE

  public readonly settings = new AiModelSettings()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<AiModelSettings>
  private readonly _context: AiModelMainContext
  private readonly _requestExecutor: AiModelRequestExecutor
  private readonly _ipcHandlers: AiModelIpcHandlers

  constructor(
    _loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _ipc: AkariIpcMain,
    network: NetworkMain,
    _settingFactory: SettingFactoryMain
  ) {
    this._logger = _loggerFactory.create(AiModelMain.id)
    this._settingService = _settingFactory.register(
      AiModelMain.id,
      {
        configs: {
          default: this.settings.configs,
          schema: aiModelConfigsSchema,
          transform: ({ value }) => normalizeAiModelConfigs(value)
        },
        activeConfigId: {
          default: this.settings.activeConfigId,
          schema: z.string().nullable()
        }
      },
      this.settings
    )

    this._context = {
      namespace: AiModelMain.id,
      settings: this.settings,
      logger: this._logger,
      settingService: this._settingService,
      ipc: this._ipc,
      httpClient: network.createAxiosClient({ timeout: AI_MODEL_REQUEST_TIMEOUT })
    }
    this._requestExecutor = new AiModelRequestExecutor(this._context.httpClient)
    this._ipcHandlers = new AiModelIpcHandlers(this._context, this._requestExecutor)
  }

  async onInit() {
    await this._settingService.applyToState()

    this._mobxUtils.propSync(AiModelMain.id, 'settings', this.settings, [
      'configs',
      'activeConfigId'
    ])

    this._ipcHandlers.register()
    this._logger.info('initialized')
  }

  async onDispose() {}
}
