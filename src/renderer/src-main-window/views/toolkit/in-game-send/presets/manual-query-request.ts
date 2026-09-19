import { reactive } from 'vue'

/**
 * 战绩页跳转到「发送到聊天」预设手动查询的跨视图请求总线。
 * PlayerTabHeader 发起，InGameSendPresetsPanel / 两个评价面板消费。
 */
export type ManualQueryPreset = 'ai-evaluation' | 'horse-grade'

export interface ManualQueryRequest {
  preset: ManualQueryPreset
  /** gameName#tagLine */
  riotId: string
  createdAt: number
}

export const manualQueryRequest = reactive<{ current: ManualQueryRequest | null }>({
  current: null
})

/** 请求有效期：避免用户很久之后才打开工具集时触发一次过期的查询 */
const REQUEST_TTL_MS = 15_000

export function requestManualQuery(request: Omit<ManualQueryRequest, 'createdAt'>) {
  manualQueryRequest.current = { ...request, createdAt: Date.now() }
}

export function consumeManualQueryRequest(): ManualQueryRequest | null {
  const request = manualQueryRequest.current
  manualQueryRequest.current = null

  if (!request || Date.now() - request.createdAt > REQUEST_TTL_MS) {
    return null
  }

  return request
}

export function peekManualQueryRequest(): ManualQueryRequest | null {
  const request = manualQueryRequest.current

  if (!request || Date.now() - request.createdAt > REQUEST_TTL_MS) {
    return null
  }

  return request
}
