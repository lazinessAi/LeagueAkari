import type { AiModelOperationErrorReason } from '@shared/shards/ai-model'

/** 模型请求失败原因 → i18n key（aiModel.config.testResult.reason.*） */
export const AI_MODEL_FAILURE_REASON_KEYS: Record<AiModelOperationErrorReason, string> = {
  'invalid-config': 'aiModel.config.testResult.reason.invalid-config',
  network: 'aiModel.config.testResult.reason.network',
  auth: 'aiModel.config.testResult.reason.auth',
  'not-found': 'aiModel.config.testResult.reason.not-found',
  unknown: 'aiModel.config.testResult.reason.unknown'
}
