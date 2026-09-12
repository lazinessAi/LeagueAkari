import type { AiModelConfig } from '@shared/shards/ai-model'
import { z } from 'zod'

export const aiModelConfigSchema: z.ZodType<AiModelConfig> = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.enum(['openai', 'anthropic']),
  baseUrl: z.string(),
  apiKey: z.string(),
  modelId: z.string(),
  note: z.string()
})

export const aiModelConfigsSchema: z.ZodType<AiModelConfig[]> = z.array(aiModelConfigSchema)
