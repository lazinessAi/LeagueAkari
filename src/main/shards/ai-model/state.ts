import type { AiModelConfig } from '@shared/shards/ai-model'
import { makeAutoObservable, observableRef } from 'mobx'

export class AiModelSettings {
  configs: AiModelConfig[] = []
  activeConfigId: string | null = null

  constructor() {
    makeAutoObservable(this, {
      configs: observableRef
    })
  }
}
