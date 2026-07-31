import { describe, expect, it } from 'vitest'
import {
  buildPanelImagePromptFromResolvedInputs,
  buildPanelVideoPromptFromResolvedInputs,
} from '@/lib/novel-promotion/panel-generation-prompt-preview'
import type { PanelAssetBindingPlan } from '@/lib/visual-production/binding-plan'
import type { PanelVisualBindings } from '@/lib/visual-production/bindings'
import type { PanelGenerationRouteDecision } from '@/lib/visual-production/panel-generation-router'

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
})
