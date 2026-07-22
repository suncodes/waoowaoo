import { describe, expect, it } from 'vitest'
import {
  CREATION_STAGE_IDS,
  CREATION_STAGE_REGISTRY,
  isKnownCreationStageRoute,
  resolveCreationStageRoute,
} from '@/lib/creation-workspace/stages'

describe('creation workspace stages', () => {
  it('keeps a stable six-stage registry in production order', () => {
    expect(CREATION_STAGE_REGISTRY.map((stage) => stage.id)).toEqual(CREATION_STAGE_IDS)
    expect(CREATION_STAGE_REGISTRY.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it.each([
    ['overview', 'setup', 'overview'],
    ['config', 'setup', undefined],
    ['content-plan', 'content', 'plan'],
    ['content-assets', 'content', 'assets'],
    ['script', 'content', 'script'],
    ['assets', 'visual-design', 'assets'],
    ['visual-plan', 'visual-design', 'direction'],
    ['text-storyboard', 'storyboard-preview', undefined],
    ['storyboard', 'storyboard-preview', undefined],
    ['videos', 'production', 'shots'],
    ['voice', 'production', 'voice'],
    ['editor', 'edit', undefined],
  ])('maps legacy route %s to %s', (legacyStage, stageId, view) => {
    expect(resolveCreationStageRoute(legacyStage)).toEqual({
      stageId,
      view,
      isAlias: true,
    })
  })

  it('preserves an explicit subview on canonical routes', () => {
    expect(resolveCreationStageRoute('content', 'script')).toEqual({
      stageId: 'content',
      view: 'script',
      isAlias: false,
    })
  })

  it('falls back to setup for invalid routes', () => {
    expect(isKnownCreationStageRoute('unknown')).toBe(false)
    expect(resolveCreationStageRoute('unknown')).toEqual({
      stageId: 'setup',
      isAlias: true,
    })
  })
})
