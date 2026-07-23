import { describe, expect, it } from 'vitest'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'

describe('creative quality contracts', () => {
  it('creates browser-safe deterministic sha256 hashes', () => {
    const left = createCreativeQualityHash({ b: 2, a: ['中', 1] })
    const right = createCreativeQualityHash({ a: ['中', 1], b: 2 })

    expect(left).toBe('f0ecbc7e036141f18e795f27a1af9fd050baa4105d39ecd02acc9b1659a399dc')
    expect(right).toBe(left)
  })
})
