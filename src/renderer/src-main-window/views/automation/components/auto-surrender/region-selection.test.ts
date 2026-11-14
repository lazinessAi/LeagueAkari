import { autoSurrenderRegionSchema } from '@shared/shards/auto-misc/auto-surrender'
import { describe, expect, it } from 'vitest'

import { moveSelection, selectionFromPoints } from './region-selection'

describe('chat region selection', () => {
  it.each([
    [
      { x: 5, y: 60 },
      { x: 40, y: 90 }
    ],
    [
      { x: 40, y: 90 },
      { x: 5, y: 60 }
    ]
  ])('selects the same region in either drag direction', (start, end) => {
    expect(selectionFromPoints(start, end)).toEqual({ x: 5, y: 60, width: 35, height: 30 })
  })

  it('clamps a drag released outside the game preview', () => {
    expect(selectionFromPoints({ x: 20, y: 60 }, { x: -10, y: 140 })).toEqual({
      x: 0,
      y: 60,
      width: 20,
      height: 40
    })
  })

  it('keeps a tiny selection at the bottom-right edge valid and nonempty', () => {
    expect(selectionFromPoints({ x: 100, y: 100 }, { x: 100, y: 100 })).toEqual({
      x: 99,
      y: 99,
      width: 1,
      height: 1
    })
  })

  it('moves the selection up to the edge without shrinking it', () => {
    const region = { x: 5, y: 60, width: 35, height: 30 }
    expect(moveSelection(region, { x: -20, y: 40 })).toEqual({
      x: 0,
      y: 70,
      width: 35,
      height: 30
    })
    expect(moveSelection(region, { x: 200, y: -200 })).toEqual({
      x: 65,
      y: 0,
      width: 35,
      height: 30
    })
  })

  it('preserves the persisted region contract for fractional and out-of-bounds pointer positions', () => {
    const points = [-20, 0, 0.01, 33.3333, 64.02, 99.999, 100, 140]
    for (const x of points) {
      for (const y of points) {
        const region = selectionFromPoints({ x: 35.98, y: 70.97 }, { x, y })
        expect(autoSurrenderRegionSchema.safeParse(region).success, JSON.stringify(region)).toBe(
          true
        )
        const moved = moveSelection(region, { x: 100, y: 100 })
        expect(autoSurrenderRegionSchema.safeParse(moved).success, JSON.stringify(moved)).toBe(true)
      }
    }
  })
})
