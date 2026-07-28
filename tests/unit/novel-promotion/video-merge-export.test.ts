import { describe, expect, it } from 'vitest'
import { buildMergedVideoAccessUrls } from '@/lib/novel-promotion/video-merge-export'

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
})
