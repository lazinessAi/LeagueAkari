import { AUTO_MISC_MAIN_NAMESPACE, type AutoMiscRendererContext } from './context'
import { useAutoMiscStore } from './store'

export async function syncAutoMiscSettings(context: AutoMiscRendererContext) {
  const store = useAutoMiscStore()

  await context.piniaMobxUtils.sync(AUTO_MISC_MAIN_NAMESPACE, 'settings', store.settings)
  await context.piniaMobxUtils.sync(
    AUTO_MISC_MAIN_NAMESPACE,
    'autoAcceptSurrender',
    store.autoAcceptSurrender
  )
  await context.piniaMobxUtils.sync(AUTO_MISC_MAIN_NAMESPACE, 'autoSurrender', store.autoSurrender)
}
