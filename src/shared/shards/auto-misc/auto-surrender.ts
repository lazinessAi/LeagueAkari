import { z } from 'zod'

import type { GameflowPhase } from '../../types/league-client/gameflow'

// Do not stop on the first end transition: the surrender animation can still accept input.
export const AUTO_SURRENDER_GAME_PHASES: readonly GameflowPhase[] = [
  'InProgress',
  'PreEndOfGame',
  'WaitingForStats'
]

export const autoSurrenderRegionSchema = z
  .object({
    x: z.number().min(0).max(99),
    y: z.number().min(0).max(99),
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100)
  })
  .refine((region) => region.x + region.width <= 100 && region.y + region.height <= 100)

export type AutoSurrenderRegion = z.infer<typeof autoSurrenderRegionSchema>

// Bottom-left quadrant of the game window's client area, independent of DPI/resolution.
export const DEFAULT_AUTO_SURRENDER_REGION: AutoSurrenderRegion = {
  x: 0,
  y: 50,
  width: 50,
  height: 50
}

// Covers the usual vote panel above the minimap. The panel may be moved in game.
export const DEFAULT_AUTO_ACCEPT_SURRENDER_REGION: AutoSurrenderRegion = {
  x: 50,
  y: 50,
  width: 50,
  height: 50
}

export type AutoSurrenderStatus =
  'idle' | 'starting' | 'watching' | 'paused' | 'triggered' | 'unavailable' | 'error'

export type AutoSurrenderError =
  | 'native-input-unavailable'
  | 'ocr-language-unavailable'
  | 'ocr-initialization-failed'
  | 'ocr-scan-failed'
  | 'ocr-timeout'
  | 'ocr-worker-exited'
  | 'send-failed'

export interface AutoSurrenderSnapshot {
  status: AutoSurrenderStatus
  error: AutoSurrenderError | null
  lastText: string
  lastScanDurationMs: number | null
}
