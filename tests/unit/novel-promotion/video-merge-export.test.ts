import { describe, expect, it } from 'vitest'
import {
  buildMergedVideoAccessUrls,
  restoreStoredVideoMergeExportResult,
} from '@/lib/novel-promotion/video-merge-export'

describe('merged video access URLs', () => {
  it('uses the range-capable video proxy for preview and keeps download explicit', () => {
    const result = buildMergedVideoAccessUrls({
      projectId: 'project / 1',
      outputKey: 'videos/merged/project / 1/final video.mp4',
      fileName: '导读成片.mp4',
    })

    expect(result.outputUrl).toBe('/api/novel-promotion/project%20%2F%201/video-proxy?key=videos%2Fmerged%2Fproject%20%2F%201%2Ffinal%20video.mp4')
    expect(result.outputUrl).not.toContain('download=1')
    expect(result.downloadUrl).toBe(`${result.outputUrl}&download=1&filename=%E5%AF%BC%E8%AF%BB%E6%88%90%E7%89%87.mp4`)
  })

  it('restores old stored results through the video proxy', () => {
    const result = restoreStoredVideoMergeExportResult({
      projectId: 'project-1',
      taskId: 'task-1',
      finishedAt: new Date('2026-07-28T08:00:00.000Z'),
      result: {
        outputUrl: 'videos/merged/project-1/final.mp4',
        fileName: '最终成片.mp4',
        videoCount: 12,
        sizeBytes: 1024,
      },
    })

    expect(result).toMatchObject({
      taskId: 'task-1',
      mergedAt: '2026-07-28T08:00:00.000Z',
      outputKey: 'videos/merged/project-1/final.mp4',
      outputUrl: '/api/novel-promotion/project-1/video-proxy?key=videos%2Fmerged%2Fproject-1%2Ffinal.mp4',
      downloadUrl: '/api/novel-promotion/project-1/video-proxy?key=videos%2Fmerged%2Fproject-1%2Ffinal.mp4&download=1&filename=%E6%9C%80%E7%BB%88%E6%88%90%E7%89%87.mp4',
      videoCount: 12,
      sizeBytes: 1024,
    })
  })
})
