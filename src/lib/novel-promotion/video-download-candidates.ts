export interface VideoDownloadPanelData {
  panelIndex: number | null
  description: string | null
  videoUrl: string | null
  audioMixedVideoUrl?: string | null
  lipSyncVideoUrl: string | null
  linkedToNextPanel?: boolean | null
}

export interface VideoDownloadStoryboardData {
  id: string
  clipId: string
  panels?: VideoDownloadPanelData[]
}

export interface VideoDownloadClipData {
  id: string
}

export interface VideoDownloadEpisodeData {
  storyboards?: VideoDownloadStoryboardData[]
  clips?: VideoDownloadClipData[]
}

export interface OrderedVideoCandidate {
  storyboardId: string
  panelKey: string
  description: string
  videoUrl: string
  clipIndex: number
  panelIndex: number
  isLipSync: boolean
  isAudioMixed: boolean
  sourceType: 'lip_sync' | 'audio_mixed' | 'raw'
}

function normalizePanelIndex(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function buildPanelKey(storyboardId: string, panelIndex: number): string {
  return `${storyboardId}-${panelIndex}`
}

function sanitizeFileLabel(value: string): string {
  const normalized = value.trim().slice(0, 50)
  const safe = normalized.replace(/[\\/:*?"<>|]/g, '_')
  return safe || '镜头'
}

function compareOrderedVideoCandidate(left: OrderedVideoCandidate, right: OrderedVideoCandidate): number {
  if (left.clipIndex !== right.clipIndex) {
    return left.clipIndex - right.clipIndex
  }
  return left.panelIndex - right.panelIndex
}

export function buildVideoFileName(index: number, description: string, ext = 'mp4'): string {
  return `${String(index).padStart(3, '0')}_${sanitizeFileLabel(description)}.${ext}`
}

export function collectOrderedVideoCandidates(
  episodes: VideoDownloadEpisodeData[],
  panelPreferences: Record<string, boolean> = {},
): OrderedVideoCandidate[] {
  const allStoryboards: VideoDownloadStoryboardData[] = []
  const allClips: VideoDownloadClipData[] = []

  for (const episode of episodes) {
    allStoryboards.push(...(episode.storyboards || []))
    allClips.push(...(episode.clips || []))
  }

  const candidates: OrderedVideoCandidate[] = []

  for (const storyboard of allStoryboards) {
    const clipIndex = allClips.findIndex((clip) => clip.id === storyboard.clipId)
    const panels = storyboard.panels || []

    for (const panel of panels) {
      const panelIndex = normalizePanelIndex(panel.panelIndex)
      const panelKey = buildPanelKey(storyboard.id, panelIndex)
      const preferLipSync = panelPreferences[panelKey] ?? true

      let videoUrl: string | null = null
      let isLipSync = false
      let isAudioMixed = false
      let sourceType: OrderedVideoCandidate['sourceType'] = 'raw'

      if (preferLipSync) {
        videoUrl = panel.lipSyncVideoUrl || panel.audioMixedVideoUrl || panel.videoUrl
        isLipSync = !!panel.lipSyncVideoUrl
        isAudioMixed = !panel.lipSyncVideoUrl && !!panel.audioMixedVideoUrl
        sourceType = panel.lipSyncVideoUrl ? 'lip_sync' : panel.audioMixedVideoUrl ? 'audio_mixed' : 'raw'
      } else {
        videoUrl = panel.videoUrl || panel.audioMixedVideoUrl || panel.lipSyncVideoUrl
        isLipSync = !panel.videoUrl && !!panel.lipSyncVideoUrl
        isAudioMixed = !panel.videoUrl && !panel.lipSyncVideoUrl && !!panel.audioMixedVideoUrl
        sourceType = panel.videoUrl ? 'raw' : panel.audioMixedVideoUrl ? 'audio_mixed' : 'lip_sync'
      }

      if (!videoUrl) continue

      candidates.push({
        storyboardId: storyboard.id,
        panelKey,
        description: sanitizeFileLabel(panel.description || '镜头'),
        videoUrl,
        clipIndex: clipIndex >= 0 ? clipIndex : 999,
        panelIndex,
        isLipSync,
        isAudioMixed,
        sourceType,
      })
    }
  }

  candidates.sort(compareOrderedVideoCandidate)

  return candidates
}
