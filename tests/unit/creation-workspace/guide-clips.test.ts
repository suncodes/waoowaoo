import { describe, expect, it } from 'vitest'
import { getActiveWorkspaceClipIds } from '@/lib/creation-workspace/guide-clips'

describe('guide clip activity', () => {
  it('excludes logically removed guide clips from planning validation', () => {
    const activeIds = getActiveWorkspaceClipIds([
      {
        id: 'active-guide-clip',
        screenplay: JSON.stringify({
          format: 'guide',
          workspace: { removed: false },
        }),
      },
      {
        id: 'removed-guide-clip',
        screenplay: JSON.stringify({
          format: 'guide',
          workspace: { removed: true },
        }),
      },
      {
        id: 'script-clip',
        screenplay: 'INT. 舱室 - 夜',
      },
    ])

    expect(activeIds).toEqual(['active-guide-clip', 'script-clip'])
  })
})
