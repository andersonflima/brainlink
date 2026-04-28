import { describe, expect, it } from 'vitest'
import { findSensitiveContent, validateNoteInput } from './note-safety.js'

describe('note safety', () => {
  it('detects common secret patterns without exposing the secret value', () => {
    const findings = findSensitiveContent('OPENAI_API_KEY=sk-test12345678901234567890')

    expect(findings).toEqual([{ label: 'OpenAI API key' }])
  })

  it('blocks sensitive notes unless explicitly allowed', () => {
    expect(() =>
      validateNoteInput({
        title: 'Credentials',
        content: 'password=super-secret-value'
      })
    ).toThrow('Sensitive memory blocked')

    expect(() =>
      validateNoteInput({
        title: 'Credentials',
        content: 'password=super-secret-value',
        allowSensitive: true
      })
    ).not.toThrow()
  })
})
