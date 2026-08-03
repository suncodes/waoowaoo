import { beforeEach, describe, expect, it, vi } from 'vitest'

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)

import {
  createPanelVisualFactPreparationHash,
  parsePanelVisualFactInput,
  resolvePanelVisualFactsWithAI,
  type PanelVisualFactPreparationInput,
} from '@/lib/prompt-compiler/panel-visual-fact-extractor'

function buildInput(overrides: Partial<PanelVisualFactPreparationInput> = {}): PanelVisualFactPreparationInput {
  return {
    locale: 'zh',
    model: 'analysis-model',
    description: '黄铜钥匙停在保险库锁孔前。',
    imagePrompt: '低机位近景，钥匙是画面焦点。',
    sourceText: '门锁即将被打开。',
    shotType: '近景',
    cameraMove: '静止',
    location: '狭窄金属走廊',
    assetRefs: [{ name: '黄铜钥匙', role: '道具' }],
    continuity: ['人物朝向保险库右侧。'],
    styleText: '电影感硬光',
    ...overrides,
  }
}

describe('panel visual fact extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps concise renderable facts and drops JSON, UUIDs, and duplicates', () => {
    const facts = parsePanelVisualFactInput({
      narrative_intent: '表现开锁前不可逆的抉择',
      action_state: '钥匙停在锁孔前',
      environment: '狭窄金属走廊',
      composition: [
        '低机位近景',
        '低机位近景',
        '{"debug":true}',
        '4be4c9ba-70d9-4c2e-9a10-7a83a36ff891',
      ],
      lighting_and_color: '冷色侧光勾勒金属边缘',
      continuity: ['人物面朝右侧', '人物面朝右侧'],
      negative_constraints: ['不要增加第二把钥匙'],
    })

    expect(facts).toEqual({
      narrativeIntent: '表现开锁前不可逆的抉择',
      actionState: '钥匙停在锁孔前',
      environment: '狭窄金属走廊',
      composition: ['低机位近景'],
      lightingAndColor: '冷色侧光勾勒金属边缘',
      continuity: ['人物面朝右侧'],
      negativeConstraints: ['不要增加第二把钥匙'],
    })
  })

  it('reuses matching extracted facts without another model call', async () => {
    const input = buildInput()
    const preparationHash = createPanelVisualFactPreparationHash(input)

    const result = await resolvePanelVisualFactsWithAI({
      userId: 'user-1',
      projectId: 'project-1',
      input,
      reusableOptimization: {
        schemaVersion: 1,
        strategy: 'panel_visual_facts',
        source: 'llm',
        preparationHash,
        facts: {
          action_state: '钥匙停在锁孔前',
          composition: ['低机位近景'],
        },
      },
    })

    expect(result.optimization.source).toBe('reused')
    expect(result.facts).toMatchObject({ actionState: '钥匙停在锁孔前' })
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('falls back without calling the model when analysis is unavailable', async () => {
    const result = await resolvePanelVisualFactsWithAI({
      userId: 'user-1',
      projectId: 'project-1',
      input: buildInput({ model: null }),
    })

    expect(result.facts).toBeNull()
    expect(result.optimization.source).toBe('fallback')
    expect(result.optimization.validationIssues).toContain('ANALYSIS_MODEL_UNAVAILABLE')
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })
})
