import type { AkariIpcRenderer } from '../ipc'
import type { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import type { SettingUtilsRenderer } from '../setting-utils'

export const AI_MODEL_MAIN_NAMESPACE = 'ai-model-main'
export const AI_MODEL_RENDERER_NAMESPACE = 'ai-model-renderer'

export interface AiModelRendererContext {
  ipc: AkariIpcRenderer
  piniaMobxUtils: PiniaMobxUtilsRenderer
  settingUtils: SettingUtilsRenderer
}
