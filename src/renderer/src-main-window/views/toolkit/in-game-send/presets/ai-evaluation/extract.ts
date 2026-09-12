/**
 * 从模型回复中提取最终的一句话评价。
 *
 * 推理型模型即使被要求只输出 JSON，也可能先输出一大段推理文字；
 * 这里按可靠性递减做多层提取：整体 JSON → 内嵌 JSON → 句式锚点 → 原文兜底。
 */

/** 匹配句式锚点后的一句话（到第一个句号为止） */
const SENTENCE_END_PATTERN = /。/

export function extractEvaluationSentence(playerName: string, reply: string): string {
  const trimmed = reply.trim()

  // 1) 整体就是一个 JSON
  const directJson = tryParseEvaluation(trimmed)
  if (directJson !== null) {
    return stripLeadingPlayerName(directJson, playerName)
  }

  // 2) 推理文字后附带的 JSON（取第一个 { 到最后一个 } 之间的内容）
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const embeddedJson = tryParseEvaluation(trimmed.slice(firstBrace, lastBrace + 1))
    if (embeddedJson !== null) {
      return stripLeadingPlayerName(embeddedJson, playerName)
    }
  }

  // 3) 句式锚点兜底：最后一次出现 "{player} 近"，截取到第一个句号
  const anchor = `${playerName} 近`
  const anchorIndex = trimmed.lastIndexOf(anchor)
  if (anchorIndex !== -1) {
    const rest = trimmed.slice(anchorIndex)
    const endMatch = SENTENCE_END_PATTERN.exec(rest)
    const sentence = (endMatch ? rest.slice(0, endMatch.index + 1) : rest).trim()
    return stripLeadingPlayerName(sentence, playerName)
  }

  // 4) 原样兜底
  return stripLeadingPlayerName(trimmed, playerName)
}

/** 模型被要求不返回玩家名，但可能仍然带上；这里剥离以保证发送时不重复 */
function stripLeadingPlayerName(text: string, playerName: string): string {
  if (!playerName || !text.startsWith(playerName)) {
    return text
  }

  return text.slice(playerName.length).replace(/^[\s:：]+/, '')
}

function tryParseEvaluation(text: string): string | null {
  try {
    const parsed = JSON.parse(text)

    if (parsed && typeof parsed === 'object' && typeof parsed.evaluation === 'string') {
      const evaluation = parsed.evaluation.trim()
      return evaluation || null
    }
  } catch {
    // 非 JSON，走下一层
  }

  return null
}
