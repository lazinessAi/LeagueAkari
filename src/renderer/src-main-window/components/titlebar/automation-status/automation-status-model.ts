import type { AkariAutoSelectGroup } from '@shared/shards/akari-api'
import { isAutoSelectGroupSupportedOnSgpServer } from '@shared/shards/akari-api'
import type { BanChampionConfig, PickChampionConfig } from '@shared/shards/auto-select'

export type AutoSelectAutomationKind =
  'pick-or-ban' | 'trade' | 'champion-swap-friend' | 'champion-swap-auto-decline'

type AutoSelectGroupAvailability = Pick<AkariAutoSelectGroup, 'groupId' | 'supportedSgpServers'>
type AutoSelectPickAutomationConfig = Pick<
  PickChampionConfig,
  | 'enabled'
  | 'benchHandleTradeEnabled'
  | 'acceptChampionSwapFromFriendsEnabled'
  | 'championSwapFriendWhitelist'
  | 'autoDeclineRepeatedChampionSwapEnabled'
>
type AutoSelectBanAutomationConfig = Pick<BanChampionConfig, 'enabled'>

export interface EnabledAutoSelectGroupsOptions {
  readonly groups: readonly AutoSelectGroupAvailability[]
  readonly pickConfig: Readonly<Record<string, AutoSelectPickAutomationConfig | undefined>>
  readonly banConfig: Readonly<Record<string, AutoSelectBanAutomationConfig | undefined>>
  readonly sgpServerId: string
  readonly leagueServers: Readonly<Record<string, unknown>>
}

export function getEnabledAutoSelectGroups(
  options: EnabledAutoSelectGroupsOptions,
  kind: AutoSelectAutomationKind
) {
  const { groups, pickConfig, banConfig, sgpServerId, leagueServers } = options

  return groups.filter((group) => {
    if (!isAutoSelectGroupSupportedOnSgpServer(group, sgpServerId, leagueServers)) {
      return false
    }

    switch (kind) {
      case 'pick-or-ban':
        return (
          pickConfig[group.groupId]?.enabled === true || banConfig[group.groupId]?.enabled === true
        )
      case 'trade':
        return pickConfig[group.groupId]?.benchHandleTradeEnabled === true
      case 'champion-swap-friend': {
        const config = pickConfig[group.groupId]
        return (
          config?.acceptChampionSwapFromFriendsEnabled === true &&
          (config?.championSwapFriendWhitelist?.length ?? 0) > 0
        )
      }
      case 'champion-swap-auto-decline':
        return pickConfig[group.groupId]?.autoDeclineRepeatedChampionSwapEnabled === true
    }
  })
}

export function getPreferredAutoSelectGroupId(
  groups: readonly AutoSelectGroupAvailability[],
  activeGroupId: string | null
) {
  if (activeGroupId && groups.some((group) => group.groupId === activeGroupId)) {
    return activeGroupId
  }

  return groups[0]?.groupId
}

export function countConfiguredChampions(...presets: readonly object[]) {
  const championIds = new Set<string>()

  for (const preset of presets) {
    for (const [championId, modeConfigs] of Object.entries(preset)) {
      if (
        modeConfigs &&
        typeof modeConfigs === 'object' &&
        Object.values(modeConfigs).some(Boolean)
      ) {
        championIds.add(championId)
      }
    }
  }

  return championIds.size
}
