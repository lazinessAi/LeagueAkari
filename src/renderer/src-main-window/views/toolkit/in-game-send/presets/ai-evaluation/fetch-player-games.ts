import type { SgpRenderer } from '@renderer-shared/shards/sgp'

import type { AramMayhemGameJson } from './aggregate'
import {
  AI_EVALUATION_GAME_COUNT,
  AI_EVALUATION_QUEUE_ID,
  AI_EVALUATION_SUMMARY_FETCH_COUNT
} from './constants'

/**
 * 拉取一名玩家最近的海克斯大乱斗对局（SGP SUMMARY 单请求即含全部 10 名参与者）。
 * 先多拉再按队列过滤，最后截取最近 N 场。
 */
export async function fetchAramMayhemGameSummaries(
  sgp: SgpRenderer,
  sgpServerId: string,
  puuid: string
): Promise<AramMayhemGameJson[]> {
  const { data } = await sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(puuid, {
    startIndex: 0,
    count: AI_EVALUATION_SUMMARY_FETCH_COUNT,
    __sgpServerId: sgpServerId
  })

  return (data.games ?? [])
    .filter(
      (game) =>
        game.json?.queueId === AI_EVALUATION_QUEUE_ID &&
        game.json.endOfGameResult === 'GameComplete'
    )
    .slice(0, AI_EVALUATION_GAME_COUNT)
    .map((game) => game.json as AramMayhemGameJson)
}
