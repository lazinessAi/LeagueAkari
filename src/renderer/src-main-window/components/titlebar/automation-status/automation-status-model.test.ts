import { describe, expect, test } from 'vitest'

import {
  type EnabledAutoSelectGroupsOptions,
  countConfiguredChampions,
  getEnabledAutoSelectGroups,
  getPreferredAutoSelectGroupId
} from './automation-status-model'

const options: EnabledAutoSelectGroupsOptions = {
  groups: [
    { groupId: 'global', supportedSgpServers: ['*'] },
    { groupId: 'current-server', supportedSgpServers: ['euw'] },
    { groupId: 'other-server', supportedSgpServers: ['kr'] }
  ],
  pickConfig: {
    global: {
      enabled: true,
      benchHandleTradeEnabled: false,
      acceptChampionSwapFromFriendsEnabled: false,
      championSwapFriendWhitelist: []
    },
    'current-server': {
      enabled: false,
      benchHandleTradeEnabled: true,
      acceptChampionSwapFromFriendsEnabled: false,
      championSwapFriendWhitelist: []
    },
    'other-server': {
      enabled: true,
      benchHandleTradeEnabled: true,
      acceptChampionSwapFromFriendsEnabled: false,
      championSwapFriendWhitelist: []
    },
    'removed-from-catalog': {
      enabled: true,
      benchHandleTradeEnabled: true,
      acceptChampionSwapFromFriendsEnabled: false,
      championSwapFriendWhitelist: []
    }
  },
  banConfig: {
    global: { enabled: false },
    'current-server': { enabled: true },
    'other-server': { enabled: true },
    'removed-from-catalog': { enabled: true }
  },
  sgpServerId: 'euw',
  leagueServers: { euw: {}, kr: {} }
}

describe('automation status model', () => {
  test('counts only enabled auto-select groups available in the current catalog and server', () => {
    expect(
      getEnabledAutoSelectGroups(options, 'pick-or-ban').map((group) => group.groupId)
    ).toEqual(['global', 'current-server'])
    expect(getEnabledAutoSelectGroups(options, 'trade').map((group) => group.groupId)).toEqual([
      'current-server'
    ])

    expect(
      getEnabledAutoSelectGroups({ ...options, sgpServerId: '' }, 'pick-or-ban').map(
        (group) => group.groupId
      )
    ).toEqual(['global'])
  })

  test('counts champion-swap-friend groups only when enabled with a non-empty whitelist', () => {
    const swapOptions: EnabledAutoSelectGroupsOptions = {
      ...options,
      sgpServerId: '',
      pickConfig: {
        // enabled + non-empty whitelist -> qualifies
        global: {
          enabled: false,
          benchHandleTradeEnabled: false,
          acceptChampionSwapFromFriendsEnabled: true,
          championSwapFriendWhitelist: [{ summonerId: 1, name: 'a' }]
        },
        // enabled + empty whitelist -> does not qualify
        'current-server': {
          enabled: false,
          benchHandleTradeEnabled: false,
          acceptChampionSwapFromFriendsEnabled: true,
          championSwapFriendWhitelist: []
        },
        // disabled + non-empty whitelist -> does not qualify
        'other-server': {
          enabled: false,
          benchHandleTradeEnabled: false,
          acceptChampionSwapFromFriendsEnabled: false,
          championSwapFriendWhitelist: [{ summonerId: 2, name: 'b' }]
        }
      }
    }

    expect(
      getEnabledAutoSelectGroups(swapOptions, 'champion-swap-friend').map((group) => group.groupId)
    ).toEqual(['global'])
  })

  test('prefers the active supported group and otherwise uses the first configured group', () => {
    const groups = getEnabledAutoSelectGroups(options, 'trade')

    expect(getPreferredAutoSelectGroupId(groups, 'current-server')).toBe('current-server')
    expect(getPreferredAutoSelectGroupId(groups, 'other-server')).toBe('current-server')
  })

  test('counts each champion once across rune and spell presets', () => {
    expect(
      countConfiguredChampions(
        { 1: { ranked: { id: 'runes' } }, 2: { aram: null } },
        { 1: { ranked: { spell1Id: 4 } }, 2: { aram: { spell1Id: 6 } } }
      )
    ).toBe(2)
  })
})
