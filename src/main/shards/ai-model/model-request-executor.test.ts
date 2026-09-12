import { describe, expect, it } from 'vitest'

import {
  extractAnthropicModelIds,
  extractAnthropicReplyPreview,
  extractOpenAiModelIds,
  extractOpenAiReplyPreview
} from './model-request-executor'

describe('model list extraction', () => {
  it('extracts ids from the OpenAI list response shape', () => {
    expect(
      extractOpenAiModelIds({
        object: 'list',
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini', owned_by: 'openai' }]
      })
    ).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('tolerates gateways returning a bare array or string entries', () => {
    expect(extractOpenAiModelIds(['gpt-a', { id: 'gpt-b' }, { name: 'no-id' }, null])).toEqual([
      'gpt-a',
      'gpt-b'
    ])
  })

  it('extracts ids from the Anthropic list response shape', () => {
    expect(
      extractAnthropicModelIds({
        data: [{ id: 'claude-sonnet-4', display_name: 'Claude Sonnet 4' }, { id: 'claude-haiku-4' }]
      })
    ).toEqual(['claude-sonnet-4', 'claude-haiku-4'])
  })

  it('returns an empty list for unexpected payloads', () => {
    expect(extractOpenAiModelIds(undefined)).toEqual([])
    expect(extractAnthropicModelIds({ error: { message: 'nope' } })).toEqual([])
  })
})

describe('reply preview extraction', () => {
  it('extracts the first choice message content from OpenAI responses', () => {
    expect(
      extractOpenAiReplyPreview({
        choices: [{ message: { role: 'assistant', content: '1' } }]
      })
    ).toBe('1')
  })

  it('joins multi-part OpenAI content arrays', () => {
    expect(
      extractOpenAiReplyPreview({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'he' },
                { type: 'text', text: 'llo' }
              ]
            }
          }
        ]
      })
    ).toBe('hello')
  })

  it('extracts text blocks from Anthropic responses', () => {
    expect(
      extractAnthropicReplyPreview({
        content: [
          { type: 'text', text: '你' },
          { type: 'tool_use', id: 'x' },
          { type: 'text', text: '好' }
        ]
      })
    ).toBe('你好')
  })

  it('returns an empty string for missing or malformed payloads', () => {
    expect(extractOpenAiReplyPreview({})).toBe('')
    expect(extractOpenAiReplyPreview(undefined)).toBe('')
    expect(extractAnthropicReplyPreview({ content: 'plain' })).toBe('plain')
  })
})
