import type { OngoingGameSnapshot } from '@shared/shards/ongoing-game'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

export const usePreviousGameStore = defineStore('shard:previous-game-renderer', () => {
  /** 对局页“当前对局 / 上一局”的激活 tab，标题栏与视图共享此状态 */
  const activeTab = ref<'current' | 'previous'>('current')

  /** 上一局的完整快照数据，形状与主进程 ongoing-game 的快照一致 */
  const snapshot = shallowRef<OngoingGameSnapshot | null>(null)

  /** 首屏数据（战绩/排位/熟练度/召唤师/标记）是否正在加载 */
  const isLoading = ref(false)

  /** 时间线详情（打野路径数据）是否正在后台补齐 */
  const isTimelineLoading = ref(false)

  const loadError = ref<string | null>(null)

  /** 当前快照对应的对局 id，用于局结束后判断战绩是否已入库 */
  const loadedGameId = ref<number | null>(null)

  return {
    activeTab,
    snapshot,
    isLoading,
    isTimelineLoading,
    loadError,
    loadedGameId
  }
})
