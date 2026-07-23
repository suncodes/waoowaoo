import { describe, expect, it } from 'vitest'
import { parseContentPlanResult } from '@/lib/content-planning'
import { approveSelectedVisualCandidate, createVisualQualityState } from '@/lib/quality-workflow'
import { resolveVideoProfile } from '@/lib/video-profile'
import { evaluateVisualReadiness } from '@/lib/visual-readiness'
import {
  assertVisionInputSupported,
  createVisualVersionHash,
  decideVisualRepair,
  parseImageQualityReviewResult,
} from '@/lib/visual-quality'
import { parseVisualPlanResult } from '@/lib/visual-planning'

function buildGuidePlanPayload() {
  return {
    creativeBrief: {
      objective: '帮助读者理解核心观点',
      audiencePromise: '三分钟掌握全书框架',
      targetDurationSec: 200,
      tone: ['清晰', '克制'],
    },
    contentPlan: {
      title: '导读标题',
      thesis: '行为由系统塑造',
      recommendationAngle: '提供可执行的方法',
      outline: [{ id: 'outline-1', title: '核心观点', question: '为什么改变很难', takeaway: '先改变环境' }],
      segments: [{
        id: 'segment-1',
        outlineId: 'outline-1',
        title: '环境优先',
        narration: '作者认为，环境比意志力更可靠。',
        visualPurpose: '解释因果关系',
        visualHints: ['书封', '因果图'],
        estimatedDurationSec: 24,
        spoilerLevel: 'light',
        sourceAnchor: { label: '第一章', quote: '环境是行为改变的隐形手。' },
      }],
    },
  }
}

function buildReviewPayload() {
  return {
    status: 'approved',
    score: 92,
    profileFitScore: 94,
    sourceSupportScore: 90,
    issues: [],
    revisionInstructions: [],
  }
}

describe('video quality workflow contracts', () => {
  it('keeps legacy projects on the AI comic shadow-review default', () => {
    const profile = resolveVideoProfile(undefined)
    expect(profile.preset).toBe('ai_comic')
    expect(profile.qualityPolicy).toMatchObject({ mode: 'shadow', maxRepairAttempts: 1 })

    const autoGuide = resolveVideoProfile({
      preset: 'book_guide',
      qualityPolicy: { mode: 'auto', maxRepairAttempts: 99 },
    })
    expect(autoGuide.contentDomain).toBe('book')
    expect(autoGuide.qualityPolicy).toMatchObject({ mode: 'auto', maxRepairAttempts: 1 })
  })

  it('parses a source-anchored book guide and rejects missing anchors', () => {
    const profile = resolveVideoProfile('book_guide')
    const payload = buildGuidePlanPayload()
    ;(payload.creativeBrief as Record<string, unknown>).hookCandidates = [{
      id: 'hook-1',
      pattern: 'question',
      line: '为什么这件事总是靠意志力失败？',
      promise: '用一个简单框架看懂行为改变',
      sourceBoundary: '基于用户提供的章节摘录，不新增作者未说过的结论',
      riskFlags: [],
    }]
    ;(payload.contentPlan.segments[0] as Record<string, unknown>).voiceRhythm = {
      role: 'opening_question',
      voiceIntent: '先抛出观众熟悉的问题',
      emotion: '好奇',
      pacing: 'fast',
      pauseAfterSec: 0.5,
    }
    ;(payload.contentPlan.segments[0] as Record<string, unknown>).sourceBoundary = {
      factualBasis: 'verified',
      allowedExpression: '可以改写为口语短句',
      forbiddenExpression: ['禁止新增作者排名'],
    }
    const result = parseContentPlanResult(payload, buildReviewPayload(), profile)

    expect(result.contentPlan.planType).toBe('guide')
    expect(result.creativeBrief.hookCandidates?.[0]).toMatchObject({
      id: 'hook-1',
      pattern: 'question',
      line: '为什么这件事总是靠意志力失败？',
    })
    if (result.contentPlan.planType === 'guide') {
      expect(result.contentPlan.segments[0].sourceAnchor.label).toBe('第一章')
      expect(result.contentPlan.segments[0].voiceRhythm).toMatchObject({
        role: 'opening_question',
        pacing: 'fast',
      })
      expect(result.contentPlan.segments[0].sourceBoundary).toMatchObject({
        factualBasis: 'verified',
        forbiddenExpression: ['禁止新增作者排名'],
      })
      expect(result.contentPlan.hookPattern).toBe('question')
      expect(result.contentPlan.sourceLedger).toEqual([expect.objectContaining({
        label: '第一章',
        sourceType: 'user_source',
      })])
      expect(result.contentPlan.segments[0].riskFlags).toEqual([])
    }

    const jargonPayload = buildGuidePlanPayload()
    jargonPayload.contentPlan.title = '开头钩子与 CTA'
    jargonPayload.contentPlan.outline[0].title = '基础设定科普'
    jargonPayload.contentPlan.segments[0].title = '钩子'
    const normalized = parseContentPlanResult(jargonPayload, buildReviewPayload(), profile)
    if (normalized.contentPlan.planType === 'guide') {
      expect(normalized.contentPlan.title).toBe('开场问题与 结尾提示')
      expect(normalized.contentPlan.outline[0].title).toBe('背景与基本设定')
      expect(normalized.contentPlan.segments[0].title).toBe('开场引导')
    }

    const invalidPayload = buildGuidePlanPayload()
    delete (invalidPayload.contentPlan.segments[0] as { sourceAnchor?: unknown }).sourceAnchor
    expect(() => parseContentPlanResult(invalidPayload, buildReviewPayload(), profile))
      .toThrow('segments.0.sourceAnchor is required')
  })

  it('parses visual units against existing clips and supplies stable shot defaults', () => {
    const profile = resolveVideoProfile('book_guide')
    const rawPlan = {
      directorTreatment: {
        narrativeStrategy: '旁白驱动',
        pacing: '由问题到方法',
        cameraLanguage: '稳定构图',
        transitionStrategy: '图形匹配',
        soundStrategy: '克制配乐',
      },
      productionBible: {
        visualStyle: '编辑式插画',
        lightingBaseline: '柔和自然光',
        colorGrade: '中性暖色',
        compositionRules: ['主体清晰'],
        continuityRules: ['色温一致'],
        forbiddenPatterns: ['乱码文字'],
      },
      shotPlan: { summary: '单镜头说明', totalEstimatedDurationSec: 20 },
      visualUnits: [{
        clipId: 'clip-1',
        panelNumber: 1,
        visualType: 'diagram',
        renderMode: 'composite',
        description: '展示行为循环图',
        imagePrompt: '清晰的行为循环信息图',
        videoPrompt: '镜头缓慢推进到循环中心',
        durationSec: 8,
        shotSpec: {
          narrativeIntent: '解释行为循环',
          shotFunction: 'evidence',
          primarySubject: '行为循环图',
          promptBlueprint: {
            subject: ['行为循环图主体'],
            environment: ['干净纸面背景'],
            action: ['图形中心轻微强调'],
            camera: ['正视角中景'],
            lighting: ['柔和自然光'],
            style: ['编辑式插画'],
            negative: ['禁止乱码文字'],
          },
        },
      }],
    }

    const result = parseVisualPlanResult(rawPlan, profile, ['clip-1'])
    expect(result.visualUnits[0].shotSpec.startState).toBe('stable opening state')
    expect(result.visualUnits[0].shotSpec.durationIntent).toBe('8 seconds')
    expect(result.visualUnits[0].shotSpec.shotFunction).toBe('evidence')
    expect(result.visualUnits[0].shotSpec.primarySubject).toBe('行为循环图')
    expect(result.visualUnits[0].shotSpec.promptBlueprint?.negative).toEqual(['禁止乱码文字'])
    expect(result.visualUnits[0].shotSpec.singleImageFeasibility.status).toBe('feasible')
    expect(result.shotPlan.shotBudget.totalShots).toBe(1)
    expect(result.shotPlan.functionMix).toEqual([{ shotFunction: 'evidence', count: 1 }])
    expect(() => parseVisualPlanResult(rawPlan, profile, ['clip-other']))
      .toThrow('clipId does not exist')
    expect(() => parseVisualPlanResult(rawPlan, profile, ['clip-1', 'clip-2']))
      .toThrow('visualUnits missing clipIds: clip-2')
  })

  it('uses thresholds and bounded retries to choose approve, edit, regenerate, or human review', () => {
    const passed = parseImageQualityReviewResult({
      status: 'passed',
      selectedCandidateIndex: 0,
      score: 93,
      confidence: 0.94,
      candidates: [{ candidateIndex: 0, score: 93, confidence: 0.94, passed: true, issues: [] }],
      promptPatch: {},
    }, 'version-1')
    expect(decideVisualRepair({
      review: passed,
      attempt: 0,
      maxAttempts: 2,
      autoApproveThreshold: 90,
      minConfidence: 0.9,
      editModelAvailable: true,
    }).action).toBe('approve')

    const localized = parseImageQualityReviewResult({
      status: 'repairable',
      selectedCandidateIndex: 0,
      candidates: [{
        candidateIndex: 0,
        score: 70,
        confidence: 0.9,
        passed: false,
        issues: [{ code: 'ANATOMY_ERROR', severity: 'major' }],
      }],
      promptPatch: { add: ['correct hand anatomy'] },
    }, 'version-2')
    expect(decideVisualRepair({
      review: localized,
      attempt: 0,
      maxAttempts: 2,
      autoApproveThreshold: 90,
      minConfidence: 0.9,
      editModelAvailable: true,
    }).action).toBe('edit')

    const structural: typeof localized = { ...localized, issueCodes: ['SUBJECT_MISMATCH'] }
    expect(decideVisualRepair({
      review: structural,
      attempt: 0,
      maxAttempts: 2,
      autoApproveThreshold: 90,
      minConfidence: 0.9,
      editModelAvailable: true,
    }).action).toBe('regenerate')
    expect(decideVisualRepair({
      review: localized,
      attempt: 2,
      maxAttempts: 2,
      autoApproveThreshold: 90,
      minConfidence: 0.9,
      editModelAvailable: true,
    }).action).toBe('human_required')
  })

  it('keeps version hashes deterministic and only blocks unfinished automatic reviews', () => {
    const left = createVisualVersionHash({ target: { b: 2, a: 1 }, candidates: ['a.png'] })
    const right = createVisualVersionHash({ candidates: ['a.png'], target: { a: 1, b: 2 } })
    expect(left).toBe(right)
    expect(createVisualVersionHash({ candidates: ['b.png'], target: { a: 1, b: 2 } })).not.toBe(left)

    expect(evaluateVisualReadiness(undefined).ready).toBe(true)
    expect(evaluateVisualReadiness(createVisualQualityState({
      mode: 'shadow', status: 'failed', versionHash: left, candidateUrls: ['a.png'],
    })).ready).toBe(true)
    expect(evaluateVisualReadiness(createVisualQualityState({
      mode: 'auto', status: 'reviewing', versionHash: left, candidateUrls: ['a.png'],
    }))).toMatchObject({ ready: false, status: 'pending' })
    expect(evaluateVisualReadiness(createVisualQualityState({
      mode: 'auto', status: 'approved', versionHash: left, candidateUrls: ['a.png'],
    }))).toMatchObject({ ready: false, status: 'blocked', reasons: ['awaiting_human_confirmation'] })

    const humanApproved = approveSelectedVisualCandidate(createVisualQualityState({
      mode: 'auto', status: 'human_required', versionHash: left, candidateUrls: ['a.png'],
    }), 'a.png')
    expect(humanApproved).toMatchObject({
      status: 'approved',
      activeCandidateUrl: 'a.png',
      lastAction: 'select_candidate',
    })
    expect(evaluateVisualReadiness(humanApproved)).toMatchObject({ ready: true, status: 'ready' })
  })

  it('accepts only cataloged LLM models with explicit vision input support', () => {
    expect(() => assertVisionInputSupported('google::gemini-3-flash-preview')).not.toThrow()
    expect(() => assertVisionInputSupported('openai::gpt-5.2')).toThrow('VISION_INPUT_NOT_SUPPORTED')
    expect(() => assertVisionInputSupported('invalid-model-key')).toThrow('MODEL_KEY_INVALID')
  })
})
