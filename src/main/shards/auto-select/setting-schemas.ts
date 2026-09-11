import { z } from 'zod'

import type { AutoSelectSettings } from './state'

const autoPickBanStrategySchema = z.enum(['just-show', 'show-and-lock-in', 'lock-in-immediately'])

const positionChampionSchema = z
  .object({
    default: z.array(z.number()),
    top: z.array(z.number()),
    jungle: z.array(z.number()),
    middle: z.array(z.number()),
    bottom: z.array(z.number()),
    utility: z.array(z.number())
  })
  .catchall(z.array(z.number()))

const pickChampionConfigSchema = z.object({
  enabled: z.boolean(),
  champions: positionChampionSchema,
  delaySeconds: z.number(),
  ignoreIntent: z.boolean(),
  strategy: autoPickBanStrategySchema,
  showIntent: z.boolean(),
  benchSelectFirstAvailableChampion: z.boolean(),
  benchSwapAccumulatedDelaySeconds: z.number(),
  benchHandleTradeEnabled: z.boolean(),
  acceptChampionSwapFromFriendsEnabled: z.boolean(),
  championSwapFriendWhitelist: z.array(z.object({ summonerId: z.number(), name: z.string() })),
  // default 用于兼容缺少该键的历史持久化数据，缺省视为关闭
  autoDeclineRepeatedChampionSwapEnabled: z.boolean().default(false)
})

const banChampionConfigSchema = z.object({
  enabled: z.boolean(),
  champions: positionChampionSchema,
  strategy: autoPickBanStrategySchema,
  delaySeconds: z.number()
})

export const autoSelectPickConfigSchema: z.ZodType<AutoSelectSettings['pickConfig']> = z.record(
  z.string(),
  pickChampionConfigSchema
)

export const autoSelectBanConfigSchema: z.ZodType<AutoSelectSettings['banConfig']> = z.record(
  z.string(),
  banChampionConfigSchema
)
