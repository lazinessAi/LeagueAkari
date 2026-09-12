import {
  AI_MODEL_TEST_MAX_TOKENS,
  AI_MODEL_TEST_PROMPT,
  ANTHROPIC_VERSION_HEADER_VALUE,
  type AiModelChatCompletionOptions,
  type AiModelChatMessage,
  type AiModelChatResult,
  type AiModelConfig,
  type AiModelFetchModelsResult,
  type AiModelOperationErrorReason,
  type AiModelOperationFailure,
  type AiModelTestResult,
  joinAiModelApiUrl,
  normalizeAiModelBaseUrl,
  normalizeAiModelConfig
} from '@shared/shards/ai-model'
import axios, { type AxiosInstance } from 'axios'

import { aiModelConfigSchema } from './setting-schemas'

/** OpenAI 协议 /models 响应里的单个模型条目可能形如 {id} 或直接是字符串 */
export function extractOpenAiModelIds(payload: unknown): string[] {
  return extractModelList(payload)
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }

      if (item && typeof item === 'object' && 'id' in item) {
        return String((item as { id: unknown }).id ?? '')
      }

      return ''
    })
    .filter((id) => id.length > 0)
}

/** Anthropic /models 响应形如 {data: [{id}]} */
export function extractAnthropicModelIds(payload: unknown): string[] {
  return extractModelList(payload)
    .map((item) => {
      if (item && typeof item === 'object' && 'id' in item) {
        return String((item as { id: unknown }).id ?? '')
      }

      return ''
    })
    .filter((id) => id.length > 0)
}

function extractModelList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: unknown[] }).data
  }

  return []
}

/** OpenAI chat/completions 回复在 choices[0].message.content，兼容多段 content */
export function extractOpenAiReplyPreview(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  const message = (choices[0] as { message?: { content?: unknown } }).message
  return stringifyContentParts(message?.content)
}

/** Anthropic messages 回复在 content 的 type=text 块中 */
export function extractAnthropicReplyPreview(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  return stringifyContentParts((payload as { content?: unknown }).content)
}

function stringifyContentParts(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
          return String((part as { text?: unknown }).text ?? '')
        }

        return ''
      })
      .filter((text) => text.length > 0)
      .join('')
  }

  return ''
}

/** 部分推理模型会把思考过程以 <think> 块混在正文里返回，剥离后再交给调用方 */
function sanitizeReply(reply: string): string {
  return reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/**
 * 面向渲染端的模型请求执行器：始终使用调用方传入的完整配置发起请求，
 * 与已保存的设置无关，因此编辑中尚未保存的配置也可以直接测试。
 */
export class AiModelRequestExecutor {
  constructor(private readonly _httpClient: AxiosInstance) {}

  async fetchModelList(config: AiModelConfig): Promise<AiModelFetchModelsResult> {
    const validationFailure = this._validateConfig(config)
    if (validationFailure) {
      return validationFailure
    }

    const { protocol, baseUrl, apiKey } = normalizeAiModelConfig(config)

    try {
      if (protocol === 'anthropic') {
        const response = await this._httpClient.get(joinAiModelApiUrl(baseUrl, '/models'), {
          params: { limit: 100 },
          headers: this._createAnthropicHeaders(apiKey)
        })

        return { ok: true, models: extractAnthropicModelIds(response.data) }
      }

      const response = await this._httpClient.get(joinAiModelApiUrl(baseUrl, '/models'), {
        headers: this._createOpenAiHeaders(apiKey)
      })

      return { ok: true, models: extractOpenAiModelIds(response.data) }
    } catch (error) {
      return this._toFailure(error)
    }
  }

  /**
   * 正式的对话补全：使用给定配置（通常为当前激活配置）发送多轮消息并返回模型回复文本。
   */
  async chatCompletion(
    config: AiModelConfig,
    messages: AiModelChatMessage[],
    options: AiModelChatCompletionOptions = {}
  ): Promise<AiModelChatResult> {
    const validationFailure = this._validateConfig(config)
    if (validationFailure) {
      return validationFailure
    }

    const { protocol, baseUrl, apiKey, modelId } = normalizeAiModelConfig(config)
    if (!modelId) {
      return this._createFailure('invalid-config', 'model id is empty')
    }

    const temperature = options.temperature ?? 0.2
    const maxTokens = options.maxTokens ?? 512

    try {
      let response: { data: unknown }

      if (protocol === 'anthropic') {
        response = await this._httpClient.post(
          joinAiModelApiUrl(baseUrl, '/messages'),
          {
            model: modelId,
            messages: messages.filter((m) => m.role !== 'system'),
            system: messages
              .filter((m) => m.role === 'system')
              .map((m) => m.content)
              .join('\n\n'),
            temperature,
            max_tokens: maxTokens
          },
          {
            headers: this._createAnthropicHeaders(apiKey),
            timeout: options.timeoutMs
          }
        )

        return { ok: true, reply: sanitizeReply(extractAnthropicReplyPreview(response.data)) }
      }

      response = await this._httpClient.post(
        joinAiModelApiUrl(baseUrl, '/chat/completions'),
        {
          model: modelId,
          messages,
          temperature,
          max_tokens: maxTokens
        },
        {
          headers: this._createOpenAiHeaders(apiKey),
          timeout: options.timeoutMs
        }
      )

      return { ok: true, reply: sanitizeReply(extractOpenAiReplyPreview(response.data)) }
    } catch (error) {
      return this._toFailure(error)
    }
  }

  async testConfig(config: AiModelConfig): Promise<AiModelTestResult> {
    const validationFailure = this._validateConfig(config)
    if (validationFailure) {
      return validationFailure
    }

    const { protocol, baseUrl, apiKey, modelId } = normalizeAiModelConfig(config)
    const messages = [{ role: 'user', content: AI_MODEL_TEST_PROMPT }]
    const startedAt = Date.now()

    try {
      let response: { data: unknown }

      if (protocol === 'anthropic') {
        response = await this._httpClient.post(
          joinAiModelApiUrl(baseUrl, '/messages'),
          {
            model: modelId,
            messages,
            max_tokens: AI_MODEL_TEST_MAX_TOKENS
          },
          { headers: this._createAnthropicHeaders(apiKey) }
        )

        return {
          ok: true,
          durationMs: Date.now() - startedAt,
          replyPreview: extractAnthropicReplyPreview(response.data)
        }
      }

      response = await this._httpClient.post(
        joinAiModelApiUrl(baseUrl, '/chat/completions'),
        {
          model: modelId,
          messages,
          max_tokens: AI_MODEL_TEST_MAX_TOKENS
        },
        { headers: this._createOpenAiHeaders(apiKey) }
      )

      return {
        ok: true,
        durationMs: Date.now() - startedAt,
        replyPreview: extractOpenAiReplyPreview(response.data)
      }
    } catch (error) {
      return this._toFailure(error)
    }
  }

  /** 校验失败时返回结构化失败结果，成功时返回 null */
  private _validateConfig(config: AiModelConfig): AiModelOperationFailure | null {
    const parsed = aiModelConfigSchema.safeParse(config)
    if (!parsed.success) {
      return this._createFailure('invalid-config', 'malformed model config')
    }

    if (!normalizeAiModelBaseUrl(parsed.data.baseUrl)) {
      return this._createFailure('invalid-config', 'base url is empty')
    }

    return null
  }

  private _createOpenAiHeaders(apiKey: string) {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
  }

  private _createAnthropicHeaders(apiKey: string) {
    return {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION_HEADER_VALUE
    }
  }

  private _toFailure(error: unknown): AiModelOperationFailure {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status

      if (status === 401 || status === 403) {
        return this._createFailure('auth', `HTTP ${status}`)
      }

      if (status === 404) {
        return this._createFailure('not-found', 'HTTP 404')
      }

      if (error.response) {
        return this._createFailure('unknown', `HTTP ${status} ${formatResponseSnippet(error)}`)
      }

      return this._createFailure('network', error.code || error.message)
    }

    const message = error instanceof Error ? error.message : String(error)
    return this._createFailure('unknown', message)
  }

  private _createFailure(
    reason: AiModelOperationErrorReason,
    message: string
  ): AiModelOperationFailure {
    return { ok: false, reason, message }
  }
}

function formatResponseSnippet(error: { response?: { data?: unknown } }): string {
  const { data } = error.response ?? {}

  if (data === undefined || data === null) {
    return ''
  }

  if (typeof data === 'string') {
    return data.slice(0, 200)
  }

  try {
    return JSON.stringify(data).slice(0, 200)
  } catch {
    return ''
  }
}
