import { describe, expect, it } from 'vitest'
import { createVisualQualityState } from '@/lib/quality-workflow'
import { resolveVisualWorkflowPresentation } from '@/lib/visual-workflow/status'

describe('visual workflow status projection', () => {
  it('treats human confirmation as final over stale quality tasks', () => {
    const presentation = resolveVisualWorkflowPresentation({
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'human_required',
        versionHash: 'version-1',
        candidateUrls: ['frame.png'],
        activeCandidateUrl: 'frame.png',
        humanConfirmedAt: '2026-07-22T10:00:00.000Z',
      }),
      taskStates: [
        {
          phase: 'processing',
          taskType: 'visual_auto_repair',
          progress: 60,
        },
      ],
      hasCandidates: true,
      hasPrimaryImage: true,
    })

    expect(presentation.phase).toBe('approved')
    expect(presentation.status).toBe('locked')
    expect(presentation.blocksConfirmation).toBe(false)
  })

  it('keeps a new image generation task visible even if the previous image was confirmed', () => {
    const presentation = resolveVisualWorkflowPresentation({
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'approved',
        versionHash: 'version-1',
        candidateUrls: ['frame.png'],
        activeCandidateUrl: 'frame.png',
        humanConfirmedAt: '2026-07-22T10:00:00.000Z',
      }),
      taskStates: [
        {
          phase: 'processing',
          taskType: 'image_panel',
          progress: 25,
        },
      ],
      hasCandidates: true,
      hasPrimaryImage: true,
    })

    expect(presentation.phase).toBe('generating')
    expect(presentation.status).toBe('generating')
    expect(presentation.blocksConfirmation).toBe(true)
  })

  it('treats machine approval as awaiting human confirmation', () => {
    const presentation = resolveVisualWorkflowPresentation({
      visualQualityState: createVisualQualityState({
        mode: 'auto',
        status: 'approved',
        versionHash: 'version-1',
        candidateUrls: ['frame.png'],
        activeCandidateUrl: 'frame.png',
      }),
      hasCandidates: true,
      candidateCount: 1,
      hasPrimaryImage: true,
    })

    expect(presentation.phase).toBe('human_required')
    expect(presentation.status).toBe('needs_review')
    expect(presentation.blocksConfirmation).toBe(false)
  })

  it('does not fall back to editable draft status for image-only workflows', () => {
    const presentation = resolveVisualWorkflowPresentation({
      hasDraft: true,
      allowDraftStatus: false,
      emptyLabel: '未生成',
    })

    expect(presentation.phase).toBe('idle')
    expect(presentation.status).toBe('empty')
    expect(presentation.label).toBe('未生成')
  })
})
