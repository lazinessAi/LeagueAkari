export const PREVIOUS_GAME_RENDERER_NAMESPACE = 'previous-game-renderer'

/** EndOfGame 后等待战绩入库的初始延迟（毫秒） */
export const END_OF_GAME_INITIAL_RETRY_DELAY = 20_000

/** EndOfGame 后战绩入库轮询间隔（毫秒） */
export const END_OF_GAME_RETRY_INTERVAL = 30_000

/** EndOfGame 后战绩入库的最大重试次数 */
export const END_OF_GAME_MAX_RETRIES = 5
