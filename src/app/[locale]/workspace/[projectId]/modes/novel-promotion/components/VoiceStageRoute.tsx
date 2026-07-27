'use client'

import VoiceStage from './VoiceStage'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceProvider } from '../WorkspaceProvider'

export default function VoiceStageRoute({
  embedded = false,
  nativeAudioMode = false,
}: {
  embedded?: boolean
  nativeAudioMode?: boolean
}) {
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()

  if (!episodeId) return null

  return (
    <VoiceStage
      projectId={projectId}
      episodeId={episodeId}
      embedded={embedded}
      nativeAudioMode={nativeAudioMode}
      onBack={() => runtime.onStageChange('storyboard-images')}
      onOpenAssetLibraryForCharacter={(characterId) =>
        characterId
          ? runtime.onOpenAssetLibraryForCharacter(characterId, false)
          : runtime.onOpenAssetLibrary()
      }
    />
  )
}
