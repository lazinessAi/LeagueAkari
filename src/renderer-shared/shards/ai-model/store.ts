import type { AiModelConfig } from '@shared/shards/ai-model'
import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export const useAiModelStore = defineStore('shard:ai-model-renderer', () => {
  const settings = shallowReactive({
    configs: [] as AiModelConfig[],
    activeConfigId: null as string | null
  })

  return {
    settings
  }
})
