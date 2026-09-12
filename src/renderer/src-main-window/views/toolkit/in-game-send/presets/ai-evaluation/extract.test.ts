import { describe, expect, it } from 'vitest'

import { extractEvaluationSentence } from './extract'

describe('extractEvaluationSentence', () => {
  const playerName = 'deer#17552'

  it('parses a direct JSON reply and strips the leading player name', () => {
    expect(
      extractEvaluationSentence(
        playerName,
        '{"evaluation": "deer#17552 近50场胜率42%，无刷负嫌疑"}'
      )
    ).toBe('近50场胜率42%，无刷负嫌疑')
  })

  it('extracts embedded JSON after reasoning text', () => {
    const reply =
      '我们需要根据规则输出一句话。首先检查 sampleSize=50，胜率0.42。所以输出：{"evaluation": "deer#17552 近50场胜率42%，胜率参考性有限"}'

    expect(extractEvaluationSentence(playerName, reply)).toBe('近50场胜率42%，胜率参考性有限')
  })

  it('falls back to the sentence anchor when no JSON exists', () => {
    const reply =
      '首先检查必要信息。结论：deer#17552 近50场胜率42%（CI 29.4%-55.8%），主玩输出位。需要确认百分比格式。'

    expect(extractEvaluationSentence(playerName, reply)).toBe(
      '近50场胜率42%（CI 29.4%-55.8%），主玩输出位。'
    )
  })

  it('takes the last anchor occurrence when the player is mentioned multiple times', () => {
    const reply = 'deer#17552 近50场胜率错误草稿。修正：deer#17552 近50场胜率42%，主玩输出位。'

    expect(extractEvaluationSentence(playerName, reply)).toBe('近50场胜率42%，主玩输出位。')
  })

  it('strips a colon after the leading player name', () => {
    expect(extractEvaluationSentence(playerName, 'deer#17552：近50场胜率42%，主玩输出位')).toBe(
      '近50场胜率42%，主玩输出位'
    )
  })

  it('returns the raw reply as the last resort', () => {
    expect(extractEvaluationSentence(playerName, '完全无法解析的内容')).toBe('完全无法解析的内容')
  })

  it('returns trimmed text for empty evaluation field', () => {
    const reply = '{"evaluation": "   "}'

    expect(extractEvaluationSentence(playerName, reply)).toBe(reply)
  })
})
