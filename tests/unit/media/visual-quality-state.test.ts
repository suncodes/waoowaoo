import { describe, expect, it, vi } from 'vitest'
import {
  createVisualCandidateGroup,
  createVisualQualityState,
  type VisualQualityState,
} from '@/lib/quality-workflow'
import { resolveVisualQualityStateMediaUrls } from '@/lib/media/visual-quality-state'

const mediaMock = vi.hoisted(() => ({
  resolveMediaRefFromLegacyValue: vi.fn(async (value: unknown) => {
    if (typeof value !== 'string' || value.startsWith('/m/')) return null
    return { url: `/m/${value}` }
  }),
}))

vi.mock('@/lib/media/service', () => ({
  resolveMediaRefFromLegacyValue: mediaMock.resolveMediaRefFromLegacyValue,
}))

describe('visual quality state media projection', () => {
  it('projects candidate urls and repair lineage to display media urls', async () => {
    const state = createVisualQualityState({
      mode: 'auto',
      status: 'human_required',
      versionHash: 'version-1',
      candidateUrls: ['initial-1.png', 'repair-1.png'],
      candidateGroups: [
        createVisualCandidateGroup({
          versionHash: 'version-initial',
          origin: 'initial',
          candidateUrls: ['initial-1.png'],
        }),
        createVisualCandidateGroup({
          versionHash: 'version-repair',
          origin: 'repair',
          attempt: 1,
          candidateUrls: ['repair-1.png'],
          sourceCandidateUrl: 'initial-1.png',
          action: 'edit',
        }),
      ],
      activeCandidateUrl: 'repair-1.png',
    })

    const projected = await resolveVisualQualityStateMediaUrls(state) as VisualQualityState

    expect(projected.candidateUrls).toEqual(['/m/initial-1.png', '/m/repair-1.png'])
    expect(projected.activeCandidateUrl).toBe('/m/repair-1.png')
    expect(projected.candidateGroups).toMatchObject([
      {
        origin: 'initial',
        candidateUrls: ['/m/initial-1.png'],
        sourceCandidateUrl: null,
      },
      {
        origin: 'repair',
        attempt: 1,
        candidateUrls: ['/m/repair-1.png'],
        sourceCandidateUrl: '/m/initial-1.png',
      },
    ])
  })
})
