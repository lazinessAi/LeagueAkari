export type AiModelProtocol = 'openai' | 'anthropic'

export const AI_MODEL_PROTOCOLS = ['openai', 'anthropic'] as const

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

/**
 * Anthropic 官方要求的版本头
 */
export const ANTHROPIC_VERSION_HEADER_VALUE = '2023-06-01'

export const AI_MODEL_CONFIG_MAX_ITEMS = 50
export const AI_MODEL_NAME_MAX_LENGTH = 100
export const AI_MODEL_BASE_URL_MAX_LENGTH = 2048
export const AI_MODEL_API_KEY_MAX_LENGTH = 4096
export const AI_MODEL_MODEL_ID_MAX_LENGTH = 200
export const AI_MODEL_NOTE_MAX_LENGTH = 500

/** 连通性测试与拉取模型列表的请求超时时间 */
export const AI_MODEL_REQUEST_TIMEOUT = 30_000

/** 连通性测试发送的固定用户消息 */
export const AI_MODEL_TEST_PROMPT = '1'

/** 连通性测试允许的最大回复 token 数，够覆盖 "1" 的回应且尽量节省费用 */
export const AI_MODEL_TEST_MAX_TOKENS = 16

export interface AiModelConfig {
  id: string
  name: string
  protocol: AiModelProtocol
  /** API 地址，填写到版本段（如 https://api.openai.com/v1） */
  baseUrl: string
  apiKey: string
  modelId: string
  note: string
}

export type AiModelOperationErrorReason =
  'invalid-config' | 'network' | 'auth' | 'not-found' | 'unknown'

export interface AiModelTestSuccess {
  ok: true
  durationMs: number
  replyPreview: string
}

export interface AiModelOperationFailure {
  ok: false
  reason: AiModelOperationErrorReason
  message: string
}

export type AiModelTestResult = AiModelTestSuccess | AiModelOperationFailure

export interface AiModelFetchModelsSuccess {
  ok: true
  models: string[]
}

export type AiModelFetchModelsResult = AiModelFetchModelsSuccess | AiModelOperationFailure

export function isAiModelProtocol(value: unknown): value is AiModelProtocol {
  return AI_MODEL_PROTOCOLS.includes(value as AiModelProtocol)
}

export function getDefaultAiModelBaseUrl(protocol: AiModelProtocol): string {
  return protocol === 'anthropic' ? ANTHROPIC_DEFAULT_BASE_URL : OPENAI_DEFAULT_BASE_URL
}

export function createDefaultAiModelConfig(protocol: AiModelProtocol = 'openai'): AiModelConfig {
  return {
    id: '',
    name: '',
    protocol,
    baseUrl: getDefaultAiModelBaseUrl(protocol),
    apiKey: '',
    modelId: '',
    note: ''
  }
}

/** 归一化用户输入的 API 地址：去除首尾空白与多余的尾部斜杠 */
export function normalizeAiModelBaseUrl(baseUrl: string): string {
  return String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
}

/** 基于填到版本段的 API 地址拼接具体接口路径 */
export function joinAiModelApiUrl(baseUrl: string, path: string): string {
  return `${normalizeAiModelBaseUrl(baseUrl)}${path}`
}

/** 判断给定地址是否为（可选指定协议的）官方默认地址，用于协议切换时自动补全默认地址 */
export function isDefaultAiModelBaseUrl(baseUrl: string, protocol?: AiModelProtocol): boolean {
  const normalized = normalizeAiModelBaseUrl(baseUrl)

  if (protocol) {
    return normalized === getDefaultAiModelBaseUrl(protocol)
  }

  return normalized === OPENAI_DEFAULT_BASE_URL || normalized === ANTHROPIC_DEFAULT_BASE_URL
}

export function normalizeAiModelConfig(config: AiModelConfig): AiModelConfig {
  const rawConfig = config ?? ({} as AiModelConfig)

  return {
    id: String(rawConfig.id ?? ''),
    name: String(rawConfig.name ?? '').slice(0, AI_MODEL_NAME_MAX_LENGTH),
    protocol: isAiModelProtocol(rawConfig.protocol) ? rawConfig.protocol : 'openai',
    baseUrl: String(rawConfig.baseUrl ?? '').slice(0, AI_MODEL_BASE_URL_MAX_LENGTH),
    apiKey: String(rawConfig.apiKey ?? '').slice(0, AI_MODEL_API_KEY_MAX_LENGTH),
    modelId: String(rawConfig.modelId ?? '').slice(0, AI_MODEL_MODEL_ID_MAX_LENGTH),
    note: String(rawConfig.note ?? '').slice(0, AI_MODEL_NOTE_MAX_LENGTH)
  }
}

export function normalizeAiModelConfigs(configs: AiModelConfig[]): AiModelConfig[] {
  if (!Array.isArray(configs)) {
    return []
  }

  const seenIds = new Set<string>()
  const normalized: AiModelConfig[] = []

  for (const config of configs) {
    const normalizedConfig = normalizeAiModelConfig(config)

    if (!normalizedConfig.id || seenIds.has(normalizedConfig.id)) {
      continue
    }

    normalized.push(normalizedConfig)
    seenIds.add(normalizedConfig.id)

    if (normalized.length >= AI_MODEL_CONFIG_MAX_ITEMS) {
      break
    }
  }

  return normalized
}
