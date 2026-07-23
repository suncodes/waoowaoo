import { describe, expect, it } from 'vitest'
import type { GuideContentPlan } from '@/lib/content-planning'
import {
  addGuideSegment,
  mergeGuideSegmentWithNext,
  moveGuideSegment,
  removeGuideSegment,
  splitGuideSegment,
} from '@/lib/creation-workspace/guide-editor'

function createPlan(): GuideContentPlan {
  return {
    schemaVersion: 1,
    planType: 'guide',
    title: '海底两万里',
    thesis: '理解自由、技术与孤独',
    hookPattern: 'question',
    recommendationAngle: '经典科幻导读',
    sourceLedger: [],
    riskFlags: [],
    outline: [{ id: 'outline-1', title: '主题', question: '讲了什么', takeaway: '核心价值' }],
    segments: [
      {
        id: 'segment-1',
        outlineId: 'outline-1',
        title: '进入海底世界',
        narration: '故事从海怪传闻开始。人们最终发现，那其实是鹦鹉螺号。',
        visualPurpose: '建立悬念',
        visualHints: ['海面', '潜艇'],
        estimatedDurationSec: 20,
        spoilerLevel: 'light',
        sourceAnchor: { label: '第一章', chapter: '第一章' },
        riskFlags: [],
      },
      {
        id: 'segment-2',
        outlineId: 'outline-1',
        title: '尼摩船长',
        narration: '尼摩船长拒绝陆地世界，却保留复杂的人性。',
        visualPurpose: '介绍人物',
        visualHints: ['尼摩船长'],
        estimatedDurationSec: 18,
        spoilerLevel: 'light',
        sourceAnchor: { label: '第十章', chapter: '第十章' },
        riskFlags: [],
      },
    ],
  }
}

describe('guide editor mutations', () => {
  it('reorders stable segment ids and reports both affected units', () => {
    const result = moveGuideSegment(createPlan(), 1, -1)
    expect(result?.plan.segments.map((segment) => segment.id)).toEqual(['segment-2', 'segment-1'])
    expect(result?.changedUnitIds).toEqual(['segment-2', 'segment-1'])
  })

  it('splits narration without replacing the original segment id', () => {
    const result = splitGuideSegment({
      plan: createPlan(),
      index: 0,
      newId: 'segment-new',
      newTitle: '进入海底世界（续）',
      cursor: 10,
    })
    expect(result?.plan.segments.map((segment) => segment.id)).toEqual([
      'segment-1',
      'segment-new',
      'segment-2',
    ])
    expect(result?.plan.segments[0].narration).not.toBe('')
    expect(result?.plan.segments[1].narration).not.toBe('')
  })

  it('merges adjacent segments and keeps all visual references', () => {
    const plan = createPlan()
    plan.segments[0].sourceAnchor.visualAssetIds = ['nautilus']
    plan.segments[1].sourceAnchor.visualAssetIds = ['nemo', 'nautilus']
    const result = mergeGuideSegmentWithNext(plan, 0)
    expect(result?.plan.segments).toHaveLength(1)
    expect(result?.plan.segments[0].sourceAnchor.visualAssetIds).toEqual(['nautilus', 'nemo'])
    expect(result?.changedUnitIds).toEqual(['segment-1', 'segment-2'])
  })

  it('adds and removes a segment without mutating the source plan', () => {
    const plan = createPlan()
    const added = addGuideSegment({
      plan,
      afterIndex: 0,
      newId: 'segment-new',
      title: '新段落',
      narration: '补充内容。',
      sourceLabel: '补充来源',
    })
    const removed = removeGuideSegment(added.plan, 1)
    expect(plan.segments).toHaveLength(2)
    expect(added.plan.segments).toHaveLength(3)
    expect(removed?.plan.segments.map((segment) => segment.id)).toEqual(['segment-1', 'segment-2'])
  })
})
