import type { AutoSurrenderRegion } from '@shared/shards/auto-misc/auto-surrender'

export interface RegionPoint {
  x: number
  y: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number) => Math.round(value * 100) / 100

/** Coordinates use the game client area, regardless of preview scale or screen DPI. */
export function selectionFromPoints(start: RegionPoint, end: RegionPoint): AutoSurrenderRegion {
  const x = round(clamp(Math.min(start.x, end.x), 0, 99))
  const y = round(clamp(Math.min(start.y, end.y), 0, 99))
  const right = round(clamp(Math.max(start.x, end.x), x + 1, 100))
  const bottom = round(clamp(Math.max(start.y, end.y), y + 1, 100))
  return { x, y, width: round(right - x), height: round(bottom - y) }
}

export function moveSelection(
  region: AutoSurrenderRegion,
  delta: RegionPoint
): AutoSurrenderRegion {
  return {
    ...region,
    x: round(clamp(region.x + delta.x, 0, Math.min(99, 100 - region.width))),
    y: round(clamp(region.y + delta.y, 0, Math.min(99, 100 - region.height)))
  }
}
