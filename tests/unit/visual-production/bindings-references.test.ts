import { describe, expect, it } from 'vitest'
import {
  resolvePanelVisualBindings,
} from '@/lib/visual-production/bindings'
import {
  resolvePanelAssetBindingPlan,
} from '@/lib/visual-production/binding-plan'
import {
  resolvePanelVisualReferences,
} from '@/lib/visual-production/references'
import { buildPanelImageTargetSpec } from '@/lib/workers/handlers/visual-quality-review-helpers'

const nemo = { id: 'asset-nemo', kind: 'character' as const, name: '尼摩船长' }
const bookCover = { id: 'asset-book-cover', kind: 'prop' as const, name: '《海底两万里》书封' }

function projectData() {
  return {
    characters: [{
      id: 'asset-nemo',
      name: '尼摩船长',
      appearances: [{
        id: 'appearance-nemo',
        appearanceIndex: 0,
        changeReason: '默认',
        imageUrls: JSON.stringify(['nemo.png']),
        imageUrl: 'nemo-main.png',
        selectedIndex: 0,
      }],
    }],
    locations: [{
      id: 'asset-book-cover',
      name: '《海底两万里》书封',
      assetKind: 'prop',
      images: [{
        id: 'image-book-cover',
        imageIndex: 0,
        isSelected: true,
        imageUrl: 'book-cover.png',
      }],
    }],
  }
}

describe('visual production bindings and references', () => {
  it('keeps prop motifs but does not inject character references into a book cover shot', () => {
    const panel = {
      visualType: 'book_cover',
      renderMode: 'generated_image',
      description: '展示《海底两万里》的书封设计',
      imagePrompt: '一本经典科幻小说书封',
      photographyRules: JSON.stringify({
        shotSpec: {
          primarySubject: '《海底两万里》书封',
          visibleAssets: [nemo, bookCover],
        },
      }),
    }

    const bindings = resolvePanelVisualBindings(panel)
    const references = resolvePanelVisualReferences({ projectData: projectData(), panel })

    expect(bindings.visibleAssets.map((item) => item.id)).toEqual(['asset-book-cover'])
    expect(bindings.suppressedAssets.map((item) => item.id)).toEqual(['asset-nemo'])
    expect(references.map((item) => item.assetId)).toEqual(['asset-book-cover'])
    expect(references[0]).toMatchObject({
      role: 'cover_motif',
      usage: 'must_match',
      weight: 0.65,
    })
  })

  it('marks a prop as comparison reference in diagram shots', () => {
    const panel = {
      visualType: 'diagram',
      renderMode: 'generated_image',
      description: '现代潜水艇和鹦鹉螺号潜水艇并排对比',
      imagePrompt: '两艘潜水艇水平并排摆放',
      photographyRules: JSON.stringify({
        shotSpec: {
          primarySubject: '两艘并排的潜水艇',
          visibleAssets: [{ id: 'asset-nautilus', kind: 'prop', name: '鹦鹉螺号潜水艇' }],
        },
      }),
    }

    const bindings = resolvePanelVisualBindings(panel)
    const plan = resolvePanelAssetBindingPlan(panel)

    expect(bindings.visibleAssets[0]?.role).toBe('comparison_prop')
    expect(plan.warnings.some((item) => item.code === 'COMPARISON_REFERENCE')).toBe(true)
  })

  it('does not use Nemo as identity reference for an unrelated reading girl shot', () => {
    const panel = {
      visualType: 'illustration',
      renderMode: 'generated_image',
      description: '一个女生坐在图书馆窗边阅读',
      imagePrompt: '阅读的女生，安静的图书馆光线',
      photographyRules: JSON.stringify({
        shotSpec: {
          primarySubject: '阅读的女生',
          visibleAssets: [nemo],
        },
      }),
    }

    const bindings = resolvePanelVisualBindings(panel)
    const references = resolvePanelVisualReferences({ projectData: projectData(), panel })

    expect(bindings.visibleAssets).toEqual([])
    expect(bindings.suppressedAssets.map((item) => item.id)).toEqual(['asset-nemo'])
    expect(references).toEqual([])
  })

  it('flags complex multi-character action shots before generation', () => {
    const panel = {
      visualType: 'character_action',
      renderMode: 'generated_image',
      description: '三人从船上掉入海中，水花飞溅',
      imagePrompt: '阿龙纳斯、康塞尔、尼德·兰三人落水',
      photographyRules: JSON.stringify({
        shotSpec: {
          primarySubject: '落水的三人',
          visibleAssets: [
            { id: 'a', kind: 'character', name: '阿龙纳斯' },
            { id: 'b', kind: 'character', name: '康塞尔' },
            { id: 'c', kind: 'character', name: '尼德·兰' },
          ],
        },
      }),
    }

    const plan = resolvePanelAssetBindingPlan(panel)

    expect(plan.complexity.level).toBe('high')
    expect(plan.complexity.recommendedAction).toBe('split')
    expect(plan.warnings.some((item) => item.code === 'HIGH_COMPLEXITY_SHOT')).toBe(true)
  })

  it('keeps onScreenText out of required image text for visual review', () => {
    const targetSpec = buildPanelImageTargetSpec({
      panel: {
        id: 'panel-text-card',
        description: '无字背景，右侧留白',
        imagePrompt: '深海纹理背景和书页阴影',
        shotType: 'wide',
        cameraMove: 'static',
        location: null,
        characters: null,
        props: null,
        visualType: 'quote_card',
        renderMode: 'text_card',
        onScreenText: '真正的勇气来自未知',
        linkedToNextPanel: false,
      },
      aspectRatio: '16:9',
      artStyle: 'cinematic',
      productionBible: {
        visualStyle: 'cinematic',
        continuityRules: [],
        forbiddenPatterns: [],
      },
    })

    expect(targetSpec.requiredText).toBe('')
    expect(targetSpec.continuityRules.join('\n')).toContain('downstream overlay text')
    expect(targetSpec.forbiddenPatterns.join('\n')).toContain('真正的勇气来自未知')
  })
})
