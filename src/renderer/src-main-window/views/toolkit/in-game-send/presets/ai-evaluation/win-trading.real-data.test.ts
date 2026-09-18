import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { type WinTradingGameInput, computeWinTradingSuspicion } from './win-trading'

/**
 * 用 .local 持久化的真实用户数据验证刷负算法（gitignored，CI 中自动跳过）。
 * 数据由 SGP SUMMARY 拉取脚本生成：.local/data/wt-users/<name>.json
 */
const DATA_DIR = join(process.cwd(), '.local', 'data', 'wt-users')

const GUARDIAN_ITEM_IDS = new Set([
  2049, 2050, 2051, 3112, 3177, 3184, 222051, 223112, 223177, 223184, 223185
])
const POTION_ITEM_IDS = new Set([2003, 2031, 2032, 2033])

const stat = (p: any, key: string) => (p.stats ? p.stats[key] : p[key])

const hasData = existsSync(DATA_DIR) && readdirSync(DATA_DIR).some((f) => f.endsWith('.json'))

describe.skipIf(!hasData)('win-trading algorithm (real persisted data)', () => {
  const results: Record<string, ReturnType<typeof computeWinTradingSuspicion> & { name: string }> =
    {}

  for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'))
    const playerPuuid: string = data.puuid

    const inputs: WinTradingGameInput[] = []
    for (const game of data.games) {
      const identity = (game.participantIdentities ?? []).find(
        (x: any) => x.player?.puuid === playerPuuid
      )
      const me =
        game.participants.find((p: any) => p.puuid === playerPuuid) ??
        (identity
          ? game.participants.find((p: any) => p.participantId === identity.participantId)
          : undefined)
      if (!me) continue

      const allies = game.participants.filter((p: any) => p.teamId === me.teamId)
      const enemies = game.participants.filter((p: any) => p.teamId !== me.teamId)
      const towers = (game: any, teamId: number) => {
        const entry = (game.teams ?? []).find((t: any) => t.teamId === teamId)
        return entry?.towerKills ?? entry?.objectives?.tower?.kills ?? 0
      }

      inputs.push({
        gameCreation: game.gameCreation,
        durationMin: game.gameDuration / 60,
        win: stat(me, 'win') === true || stat(me, 'win') === 'Win',
        surrendered: !!(stat(me, 'gameEndedInSurrender') || stat(me, 'gameEndedInIGNBSurrender')),
        isRemake: !!stat(me, 'gameEndedInEarlySurrender'),
        ownTowerKills: towers(game, me.teamId),
        enemyTowerKills: towers(game, me.teamId === 100 ? 200 : 100),
        teamKills: allies.reduce((sum: number, p: any) => sum + (stat(p, 'kills') ?? 0), 0),
        enemyKills: enemies.reduce((sum: number, p: any) => sum + (stat(p, 'kills') ?? 0), 0),
        guardianStart: GUARDIAN_ITEM_IDS.has(stat(me, 'item0')),
        hasPotion: [1, 2, 3, 4, 5, 6].some((i) => POTION_ITEM_IDS.has(stat(me, `item${i}`))),
        teammates: allies
          .filter((p: any) => p.participantId !== me.participantId)
          .map((p: any) => p.puuid ?? String(p.participantId))
      })
    }

    const result = computeWinTradingSuspicion(inputs)
    results[data.name] = { ...result, name: data.name }
  }

  it('known win-traders score ≥90', () => {
    for (const [name, result] of Object.entries(results)) {
      console.log(
        name,
        JSON.stringify(
          {
            probability: result.probability,
            passed: result.passed,
            insufficient: result.insufficient,
            gates: result.gates.map((g) => ({
              id: g.id,
              passed: g.passed,
              confidence: Math.round(g.confidence * 100) / 100
            })),
            intervals: result.intervals
          },
          null,
          1
        )
      )

      writeFileSync(
        join(process.cwd(), '.local', 'tmp', 'wt-validation.json'),
        JSON.stringify(results, null, 1)
      )

      if (name.includes('dear') || name.includes('deer')) {
        expect(result.probability).toBeGreaterThanOrEqual(90)
      }
    }
  })
})
