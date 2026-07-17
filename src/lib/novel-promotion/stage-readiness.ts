export type StageArtifactReadiness = {
  hasStory: boolean
  hasContentPlan: boolean
  hasScript: boolean
  hasVisualPlan: boolean
  hasStoryboard: boolean
  hasVideo: boolean
  hasVoice: boolean
}

type EpisodeClipLike = {
  screenplay?: string | null
  [key: string]: unknown
}

type StoryboardPanelLike = {
  videoUrl?: string | null
  [key: string]: unknown
}

type StoryboardLike = {
  panels?: StoryboardPanelLike[] | null
  [key: string]: unknown
}

type EpisodeLike = {
  novelText?: string | null
  creativeBrief?: unknown
  contentPlan?: unknown
  contentReview?: unknown
  directorTreatment?: unknown
  productionBible?: unknown
  clips?: unknown[] | null
  storyboards?: unknown[] | null
  voiceLines?: unknown[] | null
}

function hasNonEmptyText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function isEpisodeClipLike(value: unknown): value is EpisodeClipLike {
  return typeof value === 'object' && value !== null
}

function isStoryboardPanelLike(value: unknown): value is StoryboardPanelLike {
  return typeof value === 'object' && value !== null
}

function isStoryboardLike(value: unknown): value is StoryboardLike {
  return typeof value === 'object' && value !== null
}

function hasPersistedObject(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasScriptArtifacts(clips: unknown[] | null | undefined) {
  if (!Array.isArray(clips) || clips.length === 0) return false
  return clips.some((clip) => isEpisodeClipLike(clip) && hasNonEmptyText(clip.screenplay))
}

export function hasStoryboardArtifacts(storyboards: unknown[] | null | undefined) {
  if (!Array.isArray(storyboards) || storyboards.length === 0) return false
  return storyboards.some((storyboard) => isStoryboardLike(storyboard)
    && Array.isArray(storyboard.panels)
    && storyboard.panels.some((panel) => isStoryboardPanelLike(panel)))
}

export function hasVideoArtifacts(storyboards: unknown[] | null | undefined) {
  if (!Array.isArray(storyboards) || storyboards.length === 0) return false
  return storyboards.some((storyboard) => isStoryboardLike(storyboard)
    && Array.isArray(storyboard.panels)
    && storyboard.panels.some((panel) => isStoryboardPanelLike(panel) && hasNonEmptyText(panel.videoUrl)))
}

export function resolveEpisodeStageArtifacts(episode: EpisodeLike | null | undefined): StageArtifactReadiness {
  return {
    hasStory: hasNonEmptyText(episode?.novelText),
    hasContentPlan: hasPersistedObject(episode?.creativeBrief)
      && hasPersistedObject(episode?.contentPlan)
      && hasPersistedObject(episode?.contentReview),
    hasScript: hasScriptArtifacts(episode?.clips),
    hasVisualPlan: hasPersistedObject(episode?.directorTreatment)
      && hasPersistedObject(episode?.productionBible),
    hasStoryboard: hasStoryboardArtifacts(episode?.storyboards),
    hasVideo: hasVideoArtifacts(episode?.storyboards),
    hasVoice: Array.isArray(episode?.voiceLines) && episode.voiceLines.length > 0,
  }
}
