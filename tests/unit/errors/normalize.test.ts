import { describe, expect, it } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'

describe('normalizeAnyError', () => {
  it('maps provider copyright restriction messages to sensitive content', () => {
    const normalized = normalizeAnyError(new Error(
      'The request failed because the output video may be related to copyright restrictions. Request id: 02178533897380700000000000000000000ffffac1836b1467554',
    ))

    expect(normalized.code).toBe('SENSITIVE_CONTENT')
  })
})
