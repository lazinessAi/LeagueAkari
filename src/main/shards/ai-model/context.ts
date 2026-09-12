import type { AxiosInstance } from 'axios'

import type { AkariIpcMain } from '../ipc'
import type { AkariLogger } from '../logger-factory'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { AiModelSettings } from './state'

export const AI_MODEL_MAIN_NAMESPACE = 'ai-model-main'

export interface AiModelMainContext {
  namespace: string
  settings: AiModelSettings
  logger: AkariLogger
  settingService: SetterSettingService<AiModelSettings>
  ipc: AkariIpcMain
  httpClient: AxiosInstance
}
