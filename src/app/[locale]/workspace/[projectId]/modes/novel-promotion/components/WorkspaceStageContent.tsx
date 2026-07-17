'use client'

import ConfigStage from './ConfigStage'
import ContentPlanStage from './ContentPlanStage'
import ScriptStage from './ScriptStage'
import StoryboardStage from './StoryboardStage'
import VideoStageRoute from './VideoStageRoute'
import VisualPlanStage from './VisualPlanStage'
import VoiceStageRoute from './VoiceStageRoute'

interface WorkspaceStageContentProps {
  currentStage: string
}

export default function WorkspaceStageContent({
  currentStage,
}: WorkspaceStageContentProps) {
  return (
    <div key={currentStage} className="animate-page-enter">
      {currentStage === 'config' && <ConfigStage />}

      {currentStage === 'content-plan' && <ContentPlanStage />}

      {(currentStage === 'script' || currentStage === 'assets') && <ScriptStage />}

      {currentStage === 'visual-plan' && <VisualPlanStage />}

      {currentStage === 'storyboard' && <StoryboardStage />}

      {currentStage === 'videos' && <VideoStageRoute />}

      {currentStage === 'voice' && <VoiceStageRoute />}
    </div>
  )
}
