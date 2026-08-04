import { beforeEach, describe, expect, it, vi } from 'vitest'

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({
    text: JSON.stringify({
      identity_locks: ['深海探索载具'],
      silhouette_locks: ['长梭形船体'],
      costume_or_material_locks: ['暗铜金属外壳'],
      color_locks: ['暗铜色'],
      key_part_locks: ['圆形舷窗', '船首撞角'],
      forbidden_variants: ['禁止出现人物'],
      physical_form: 'rigid',
      orientation: 'directional',
    }),
  })),
}))

vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)

import { extractAssetVisualFactsWithAI } from '@/lib/prompt-compiler/asset-visual-fact-extractor'

describe('asset visual fact extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests constrained JSON facts and returns only the approved schema', async () => {
    const facts = await extractAssetVisualFactsWithAI({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'provider::analysis-model',
      assetKind: 'prop',
      assetName: '深海潜艇',
      description: '一艘长梭形暗铜金属潜艇，带圆形舷窗和船首撞角。',
      semanticType: 'vehicle',
    })

    expect(facts).toEqual({
      identityLocks: ['深海探索载具'],
      silhouetteLocks: ['长梭形船体'],
      costumeOrMaterialLocks: ['暗铜金属外壳'],
      colorLocks: ['暗铜色'],
      keyPartLocks: ['圆形舷窗', '船首撞角'],
      exclusions: ['禁止出现人物'],
      physicalForm: 'rigid',
      orientation: 'directional',
    })
    expect(aiRuntimeMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      action: 'extract_asset_visual_facts',
      temperature: 0.1,
    }))
  })

  it('does not call an LLM when no analysis model is configured', async () => {
    const facts = await extractAssetVisualFactsWithAI({
      userId: 'user-1',
      projectId: 'project-1',
      model: null,
      assetKind: 'prop',
      assetName: '罗盘',
      description: '黄铜罗盘',
    })

    expect(facts).toBeNull()
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })
})
