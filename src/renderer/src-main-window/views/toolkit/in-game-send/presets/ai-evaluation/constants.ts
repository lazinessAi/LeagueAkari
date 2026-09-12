/** AI 评价分析的对局范围：海克斯大乱斗（queueId 2400） */
export const AI_EVALUATION_QUEUE_ID = 2400

/** 参与聚合分析的对局数上限 */
export const AI_EVALUATION_GAME_COUNT = 50

/** 拉取战绩列表时的请求数量，先多拉再按队列过滤 */
export const AI_EVALUATION_SUMMARY_FETCH_COUNT = 100

/** 并发调用 AI 的上限（AI 提供商有限流，不允许全量并发） */
export const AI_EVALUATION_CONCURRENCY = 2

/** 正式对话补全的默认参数 */
export const AI_EVALUATION_CHAT_OPTIONS = {
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 120_000
}

/** 低于该样本数不做 AI 调用，直接返回"样本不足"（极小样本下模型输出不可控） */
export const AI_EVALUATION_MIN_SAMPLE = 10

/** 游戏聊天的单条消息长度上限，超过则按句切分为多条 */
export const AI_EVALUATION_CHAT_LINE_MAX_LENGTH = 200
