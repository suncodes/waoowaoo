import { describe, expect, it } from 'vitest'
import {
  buildAssetVisualContract,
  promptFactValues,
} from '@/lib/prompt-compiler/asset-visual-contract'

describe('asset visual contract', () => {
  it('uses AI-generated profile locks instead of classifying narrative prose with rules', () => {
    const contract = buildAssetVisualContract({
      assetKind: 'character',
      description: '唐僧与孙悟空在流沙河边争论取经路线。',
      profileData: {
        identity_locks: ['青年僧人，温和坚定的气质'],
        silhouette_locks: ['清瘦修长体态，光头，长脸'],
        costume_locks: ['朴素僧袍，外披锦襕袈裟'],
        color_locks: ['米白僧袍，朱红袈裟边饰'],
        primary_identifier: '九环锡杖与佛珠',
        visual_keywords: ['眉目清秀'],
        forbidden_variants: ['禁止现代服装'],
      },
    })

    expect(promptFactValues(contract.identityLocks)).toEqual(['青年僧人，温和坚定的气质'])
    expect(promptFactValues(contract.silhouetteLocks)).toEqual(['清瘦修长体态，光头，长脸'])
    expect(promptFactValues(contract.costumeOrMaterialLocks)).toEqual(['朴素僧袍，外披锦襕袈裟'])
    expect(promptFactValues(contract.colorLocks)).toEqual(['米白僧袍，朱红袈裟边饰'])
    expect(promptFactValues(contract.keyPartLocks)).toEqual(['九环锡杖与佛珠', '眉目清秀'])
    expect(promptFactValues(contract.exclusions)).toEqual(['禁止现代服装'])
    expect(contract.identityLocks[0]?.evidenceRefs).toEqual(['profile.identity.1'])
    expect(contract.fallbackUsed).toBe(false)
    expect(contract.sourceEvidence.map((item) => item.text)).toContain('唐僧与孙悟空在流沙河边争论取经路线。')
  })

  it('keeps an unstructured source as one fallback fact instead of duplicating it across categories', () => {
    const contract = buildAssetVisualContract({
      assetKind: 'prop',
      description: '旧黄铜材质，方形齿纹，顶部有圆形孔洞，表面有磨损痕迹',
    })

    expect(promptFactValues(contract.silhouetteLocks)).toEqual(['旧黄铜材质，方形齿纹，顶部有圆形孔洞，表面有磨损痕迹'])
    expect(contract.costumeOrMaterialLocks).toEqual([])
    expect(contract.colorLocks).toEqual([])
    expect(contract.keyPartLocks).toEqual([])
    expect(contract.fallbackUsed).toBe(true)
    expect(contract.validationIssues).toContain('NO_STRUCTURED_VISUAL_FACTS')
  })

  it('ties AI-extracted facts back to source evidence instead of treating the extraction as evidence', () => {
    const contract = buildAssetVisualContract({
      assetKind: 'prop',
      description: '一把磨损的黄铜钥匙，带方形齿纹和圆形孔洞。',
      extractedFacts: {
        silhouetteLocks: ['细长钥匙轮廓'],
        costumeOrMaterialLocks: ['磨损黄铜材质'],
      },
    })

    expect(contract.sourceEvidence).toEqual([
      {
        id: 'description.1',
        source: 'asset_description',
        text: '一把磨损的黄铜钥匙，带方形齿纹和圆形孔洞。',
        priority: 'supporting',
      },
    ])
    expect(contract.silhouetteLocks[0]?.evidenceRefs).toEqual(['description.1'])
    expect(contract.costumeOrMaterialLocks[0]?.evidenceRefs).toEqual(['description.1'])
  })

  it('uses the controlled fallback when a profile has exclusions only', () => {
    const contract = buildAssetVisualContract({
      assetKind: 'prop',
      description: '磨损黄铜钥匙，方形齿纹和圆形孔洞。',
      profileData: { forbidden_variants: ['禁止出现人物'] },
    })

    expect(contract.fallbackUsed).toBe(true)
    expect(promptFactValues(contract.silhouetteLocks)).toEqual(['磨损黄铜钥匙，方形齿纹和圆形孔洞。'])
  })
})
