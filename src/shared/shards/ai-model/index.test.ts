import { describe, expect, it } from 'vitest'

import {
  ANTHROPIC_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_BASE_URL,
  createDefaultAiModelConfig,
  isDefaultAiModelBaseUrl,
  joinAiModelApiUrl,
  normalizeAiModelBaseUrl,
  normalizeAiModelConfigs
} from '.'

describe('ai-model base url helpers', () => {
  it('trims whitespace and trailing slashes from base url', () => {
    expect(normalizeAiModelBaseUrl(' https://api.openai.com/v1/ ')).toBe(
      'https://api.openai.com/v1'
    )
    expect(normalizeAiModelBaseUrl('https://gateway.example.com///')).toBe(
      'https://gateway.example.com'
    )
    expect(normalizeAiModelBaseUrl('   ')).toBe('')
  })

  it('joins api paths onto the versioned base url', () => {
    expect(joinAiModelApiUrl('https://api.openai.com/v1/', '/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('recognizes official default base urls', () => {
    expect(isDefaultAiModelBaseUrl(OPENAI_DEFAULT_BASE_URL)).toBe(true)
    expect(isDefaultAiModelBaseUrl(`${ANTHROPIC_DEFAULT_BASE_URL}/`)).toBe(true)
    expect(isDefaultAiModelBaseUrl(OPENAI_DEFAULT_BASE_URL, 'anthropic')).toBe(false)
    expect(isDefaultAiModelBaseUrl('https://gateway.example.com/v1')).toBe(false)
  })
})

describe('ai-model config normalization', () => {
  it('creates default config with the protocol official base url', () => {
    expect(createDefaultAiModelConfig('openai').baseUrl).toBe(OPENAI_DEFAULT_BASE_URL)
    expect(createDefaultAiModelConfig('anthropic').baseUrl).toBe(ANTHROPIC_DEFAULT_BASE_URL)
  })

  it('deduplicates by id, drops id-less items and enforces the item cap', () => {
    const configs = normalizeAiModelConfigs([
      { ...createDefaultAiModelConfig(), id: 'a' },
      { ...createDefaultAiModelConfig(), id: 'a', name: 'duplicate' },
      { ...createDefaultAiModelConfig(), id: '', name: 'no id' },
      { ...createDefaultAiModelConfig(), id: 'b', protocol: 'unsupported' as never }
    ])

    expect(configs.map((config) => config.id)).toEqual(['a', 'b'])
    expect(configs[1].protocol).toBe('openai')
  })

  it('clamps oversized string fields', () => {
    const config = normalizeAiModelConfigs([
      {
        ...createDefaultAiModelConfig(),
        id: 'a',
        name: 'x'.repeat(300),
        note: 'y'.repeat(1000)
      }
    ])

    expect(config[0].name.length).toBe(100)
    expect(config[0].note.length).toBe(500)
  })

  it('returns an empty list for non-array input', () => {
    expect(normalizeAiModelConfigs(undefined as never)).toEqual([])
  })
})
