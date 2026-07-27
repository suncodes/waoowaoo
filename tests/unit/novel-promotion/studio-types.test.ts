import { describe, expect, it } from 'vitest'
import { resolveStudioMode } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/studio/studio-types'

describe('studio information architecture', () => {
  it('keeps project overview separate from content planning', () => {
    expect(resolveStudioMode('setup', 'overview')).toBe('overview')
    expect(resolveStudioMode('setup')).toBe('planning')
  })

  it('routes content plan review to planning and formal draft editing to draft', () => {
    expect(resolveStudioMode('content', 'plan')).toBe('planning')
    expect(resolveStudioMode('content', 'script')).toBe('draft')
  })

  it('keeps downstream production modes stable', () => {
    expect(resolveStudioMode('visual-design')).toBe('visual-kit')
    expect(resolveStudioMode('storyboard-preview')).toBe('storyboard-script')
    expect(resolveStudioMode('storyboard-preview', 'images')).toBe('storyboard-images')
    expect(resolveStudioMode('production')).toBe('produce')
    expect(resolveStudioMode('edit')).toBe('edit')
    expect(resolveStudioMode('edit', 'export')).toBe('export')
  })
})
