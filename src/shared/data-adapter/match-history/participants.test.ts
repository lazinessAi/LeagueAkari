import { describe, expect, it } from 'vitest'

import { calculateDamageGoldEfficiency } from './participants'

describe('calculateDamageGoldEfficiency', () => {
  it('compares a player damage share with their gold share', () => {
    const participant = {
      totalDamageDealtToChampions: 30000,
      goldEarned: 12000
    }
    const teamParticipants = [
      participant,
      { totalDamageDealtToChampions: 15000, goldEarned: 10000 },
      { totalDamageDealtToChampions: 15000, goldEarned: 8000 }
    ]

    expect(calculateDamageGoldEfficiency(participant, teamParticipants)).toBeCloseTo(1.25)
  })

  it('returns zero when a meaningful team-share comparison is impossible', () => {
    expect(
      calculateDamageGoldEfficiency({ totalDamageDealtToChampions: 100, goldEarned: 0 }, [
        { totalDamageDealtToChampions: 100, goldEarned: 100 }
      ])
    ).toBe(0)

    expect(
      calculateDamageGoldEfficiency({ totalDamageDealtToChampions: 0, goldEarned: 100 }, [
        { totalDamageDealtToChampions: 0, goldEarned: 100 }
      ])
    ).toBe(0)
  })
})
