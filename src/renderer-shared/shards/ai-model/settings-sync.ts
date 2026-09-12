import { AI_MODEL_MAIN_NAMESPACE, type AiModelRendererContext } from './context'
import { useAiModelStore } from './store'

export function syncAiModelSettings(context: AiModelRendererContext) {
  const store = useAiModelStore()

  return context.piniaMobxUtils.sync(AI_MODEL_MAIN_NAMESPACE, 'settings', store.settings)
}
