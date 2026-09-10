import { describe, expect, it } from 'vitest'
import {
  buildPanelImagePromptFromResolvedInputs,
  buildPanelReferencePlan,
  buildPanelVideoPromptFromResolvedInputs,
  resolveVideoDurationSelection,
} from '@/lib/novel-promotion/panel-generation-prompt-preview'
import type { PanelAssetBindingPlan } from '@/lib/visual-production/binding-plan'
import type { PanelVisualBindings } from '@/lib/visual-production/bindings'
import type { PanelGenerationRouteDecision } from '@/lib/visual-production/panel-generation-router'
import type { PanelVisualReferenceSelection, VisualReference } from '@/lib/visual-production/references'

const emptyBindingPlan: PanelAssetBindingPlan = {
  schemaVersion: 1,
  primarySubject: '雨夜街口的主角',
  visualType: 'illustration',
  renderMode: 'generated_image',
  bindings: [],
  suppressed: [],
  warnings: [],
  complexity: {
    score: 0,
    level: 'low',
    recommendedAction: 'generate',
    riskFlags: [],
  },
  usedShotSpec: false,
  requirementPlan: null,
}

const emptyVisualBindings: PanelVisualBindings = {
  primarySubject: emptyBindingPlan.primarySubject,
  visualType: emptyBindingPlan.visualType,
  renderMode: emptyBindingPlan.renderMode,
  visibleAssets: [],
  suppressedAssets: [],
  usedShotSpec: false,
  shotAssetRequirementPlan: null,
}

const generateDecision: PanelGenerationRouteDecision = {
  schemaVersion: 1,
  panelId: 'panel-1',
  route: 'generate',
  reasons: ['test'],
  blockingAssetNames: [],
  noReferenceReason: null,
}

describe('panel generation prompt preview compiler', () => {
  it('records both submitted and capacity-trimmed references in the prompt plan', () => {
    const selectedReference: VisualReference = {
      assetId: 'character-1',
      renderId: 'render-1',
      assetKind: 'character',
      assetName: '主角',
      url: 'hero.png',
      role: 'primary_identity',
      usage: 'must_match',
      weight: 1,
      source: 'requirement_plan',
    }
    const droppedReference: VisualReference = {
      assetId: 'location-1',
      renderId: 'render-2',
      assetKind: 'location',
      assetName: '古道',
      url: 'road.png',
      role: 'environment',
      usage: 'adapt',
      weight: 0.6,
      source: 'requirement_plan',
    }
    const referenceSelection: PanelVisualReferenceSelection = {
      maxReferences: 1,
      candidates: [selectedReference, droppedReference],
      selected: [selectedReference],
      dropped: [droppedReference],
    }

    const plan = buildPanelReferencePlan({
      bindingPlan: emptyBindingPlan,
      references: [],
      decision: generateDecision,
      referenceSelection,
    }) as { referenceSelection?: { selected?: Array<{ assetName?: string }>; dropped?: Array<{ assetName?: string }> } }

    expect(plan.referenceSelection?.selected?.map((item) => item.assetName)).toEqual(['主角'])
    expect(plan.referenceSelection?.dropped?.map((item) => item.assetName)).toEqual(['古道'])
  })

  it('compiles an image prompt from the current panel values before any generation snapshot exists', () => {
    const result = buildPanelImagePromptFromResolvedInputs({
      panel: {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        shotType: '中景',
        cameraMove: '缓慢推进',
        description: '主角站在雨夜街口',
        imagePrompt: '草稿图片提示词：主角抬头看向霓虹灯',
        videoPrompt: '雨水缓慢落下',
        location: null,
        characters: null,
        props: null,
        sourceAnchor: null,
        srtSegment: null,
        photographyRules: null,
        actingNotes: null,
        visualType: 'illustration',
        renderMode: 'generated_image',
        onScreenText: null,
      },
      projectData: {
        videoRatio: '9:16',
        characters: [],
        locations: [],
      },
      locale: 'zh',
      resolvedArtStyle: {
        source: 'preset',
        prompt: '电影感插画',
        referenceImage: null,
        referenceEnabled: false,
        referenceInstruction: '',
      },
      visualBindings: emptyVisualBindings,
      visualBindingPlan: emptyBindingPlan,
      visualReferences: [],
      generationRouteDecision: generateDecision,
      referenceImages: [],
    })

    expect(result.compiledPrompt).toContain('草稿图片提示词：主角抬头看向霓虹灯')
    expect(result.promptSpec.aspectRatio).toBe('9:16')
    expect(result.promptSpec.narrativeIntent).toBe('草稿图片提示词：主角抬头看向霓虹灯')
  })

  it('uses the current first-last-frame prompt and runtime duration in the video prompt', () => {
    const result = buildPanelVideoPromptFromResolvedInputs({
      panel: {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        description: '主角站在门口',
        imagePrompt: '主角门口定格',
        videoPrompt: '主角回头',
        cameraMove: '固定机位',
        duration: 4,
        photographyRules: null,
        promptSpec: null,
        referencePlan: null,
      },
      locale: 'zh',
      generationMode: 'firstlastframe',
      customPrompt: '草稿首尾帧提示词：从门口自然走到窗边',
      lastFrameProvided: true,
      generationOptions: {
        duration: 8,
      },
    })

    expect(result.compiledPrompt).toContain('首尾帧模式')
    expect(result.compiledPrompt).toContain('主体主运动：草稿首尾帧提示词：从门口自然走到窗边')
    expect(result.compiledPrompt).toContain('时长：约 8 秒')
    expect(result.promptSpec.durationSec).toBe(8)
  })

  it('only includes dialogue instructions when native audio is requested', () => {
    const baseParams = {
      panel: {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        description: '主角站在门口',
        imagePrompt: '主角门口定格',
        videoPrompt: '主角回头',
        cameraMove: '固定机位',
        duration: 4,
        photographyRules: null,
        promptSpec: null,
        referencePlan: null,
      },
      locale: 'zh' as const,
      generationMode: 'normal' as const,
      generationOptions: { generateAudio: false },
      panelSpeech: {
        speaker: '旁白',
        originalContent: '海底的阴影逼近。',
        deliveryContent: null,
        status: 'ready',
        voiceConfigJson: { provider: 'fal', voice: 'narrator' },
      },
    }

    const withoutNativeAudio = buildPanelVideoPromptFromResolvedInputs({
      ...baseParams,
      includeNativeAudio: false,
    })
    const withNativeAudio = buildPanelVideoPromptFromResolvedInputs({
      ...baseParams,
      includeNativeAudio: true,
    })

    expect(withoutNativeAudio.compiledPrompt).not.toContain('原生音频与台词计划')
    expect(withNativeAudio.compiledPrompt).toContain('原生音频与台词计划')
    expect(withNativeAudio.compiledPrompt).toContain('海底的阴影逼近。')
  })
})

describe('resolveVideoDurationSelection', () => {
  const seedance2 = 'ark::doubao-seedance-2-0-260128'

  it('keeps the explicitly provided duration selection', () => {
    expect(resolveVideoDurationSelection({
      modelKey: seedance2,
      panel: { targetDurationMs: 9000, duration: 9 },
      generationOptions: { duration: 7 },
    })).toBe(7)
  })

  it('picks the nearest supported duration from the panel target duration', () => {
    expect(resolveVideoDurationSelection({
      modelKey: seedance2,
      panel: { targetDurationMs: 6400, duration: 6.4 },
      generationOptions: {},
    })).toBe(7)
  })

  it('falls back to the panel duration in seconds when target duration is missing', () => {
    expect(resolveVideoDurationSelection({
      modelKey: seedance2,
      panel: { targetDurationMs: null, duration: 5 },
      generationOptions: {},
    })).toBe(5)
  })

  it('falls back to the shortest supported duration when the panel has no duration at all', () => {
    expect(resolveVideoDurationSelection({
      modelKey: seedance2,
      panel: { targetDurationMs: null, duration: null },
      generationOptions: {},
    })).toBe(4)
  })

  it('caps at the longest supported duration when the target exceeds the range', () => {
    expect(resolveVideoDurationSelection({
      modelKey: seedance2,
      panel: { targetDurationMs: 30000, duration: 30 },
      generationOptions: {},
    })).toBe(15)
  })

  it('returns undefined for models without duration options in the catalog', () => {
    expect(resolveVideoDurationSelection({
      modelKey: 'ark::not-a-catalog-video-model',
      panel: { targetDurationMs: 5000, duration: 5 },
      generationOptions: {},
    })).toBeUndefined()
  })
})
