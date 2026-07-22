'use client'

import ConfirmDialog from '@/components/ConfirmDialog'
import { WorkspaceProvider } from './WorkspaceProvider'
import WorkspaceAssetLibraryModal from './components/WorkspaceAssetLibraryModal'
import WorkspaceHeaderShell from './components/WorkspaceHeaderShell'
import StudioWorkspaceShell from './components/studio/StudioWorkspaceShell'
import { WorkspaceStageRuntimeProvider } from './WorkspaceStageRuntimeContext'
import { useNovelPromotionWorkspaceController } from './hooks/useNovelPromotionWorkspaceController'
import type { NovelPromotionWorkspaceProps } from './types'
import '@/styles/animations.css'

function NovelPromotionWorkspaceContent(props: NovelPromotionWorkspaceProps) {
  const vm = useNovelPromotionWorkspaceController(props)

  const {
    project,
    projectId,
    episodeId,
    episodes = [],
    onEpisodeSelect,
    onEpisodeCreate,
    onEpisodeRename,
    onEpisodeDelete,
  } = props

  if (!vm.project.projectData) {
    return <div className="text-center text-stone-500">{vm.i18n.tc('loading')}</div>
  }

  return (
    <div>
      <WorkspaceHeaderShell
        isSettingsModalOpen={vm.ui.isSettingsModalOpen}
        isWorldContextModalOpen={vm.ui.isWorldContextModalOpen}
        onCloseSettingsModal={() => vm.ui.setIsSettingsModalOpen(false)}
        onCloseWorldContextModal={() => vm.ui.setIsWorldContextModalOpen(false)}
        availableModels={vm.ui.userModelsForSettings || undefined}
        modelsLoaded={vm.ui.userModelsLoaded}
        artStyle={vm.project.artStyle}
        artStyleMode={vm.project.artStyleMode}
        artStylePrompt={vm.project.artStylePrompt}
        artStyleReferenceEnabled={vm.project.artStyleReferenceEnabled}
        customArtStyleReferenceImage={vm.project.customArtStyleReferenceImage}
        customArtStyleReferenceImageUrl={vm.project.customArtStyleReferenceImageUrl}
        analysisModel={vm.project.analysisModel}
        characterModel={vm.project.characterModel}
        locationModel={vm.project.locationModel}
        storyboardModel={vm.project.storyboardModel}
        editModel={vm.project.editModel}
        videoModel={vm.project.videoModel}
        audioModel={vm.project.audioModel}
        capabilityOverrides={vm.project.capabilityOverrides}
        videoRatio={vm.project.videoRatio}
        ttsRate={vm.project.ttsRate !== undefined && vm.project.ttsRate !== null ? String(vm.project.ttsRate) : undefined}
        onUpdateConfig={vm.actions.handleUpdateConfig}
        globalAssetText={vm.project.globalAssetText}
        projectName={project.name}
        episodes={episodes}
        currentEpisodeId={episodeId}
        onEpisodeSelect={onEpisodeSelect}
        onEpisodeCreate={onEpisodeCreate}
        onEpisodeRename={onEpisodeRename}
        onEpisodeDelete={onEpisodeDelete}
        onOpenAssetLibrary={() => vm.ui.openAssetLibrary()}
        onOpenSettingsModal={() => vm.ui.setIsSettingsModalOpen(true)}
        onRefresh={() => vm.ui.onRefresh({ mode: 'full' })}
        assetLibraryLabel={vm.i18n.t('buttons.assetLibrary')}
        settingsLabel={vm.i18n.t('buttons.settings')}
        refreshTitle={vm.i18n.t('buttons.refreshData')}
        showFloatingControls={false}
      />

      <a
        href="#workspace-stage-content"
        className="sr-only fixed left-4 top-4 z-[200] bg-[#e8d18a] px-3 py-2 text-sm font-semibold text-[#171810] focus:not-sr-only"
      >
        {vm.i18n.t('workspaceFlow.skipToContent')}
      </a>

      <div className="relative left-1/2 w-[min(1840px,calc(100vw-1rem))] -translate-x-1/2">
        <WorkspaceStageRuntimeProvider value={vm.runtime.stageRuntime}>
          <StudioWorkspaceShell
            projectName={project.name}
            episodes={episodes}
            currentEpisodeId={episodeId}
            currentStage={vm.stageNav.currentStage}
            stageView={vm.stageNav.stageView}
            videoProfile={vm.project.videoProfile}
            workflowState={vm.stageNav.workflowState}
            contentPlanStream={vm.execution.contentPlanStream}
            storyToScriptStream={vm.execution.storyToScriptStream}
            visualPlanStream={vm.execution.visualPlanStream}
            scriptToStoryboardStream={vm.execution.scriptToStoryboardStream}
            onStageChange={vm.stageNav.handleStageChange}
            onEpisodeSelect={onEpisodeSelect}
            onEpisodeCreate={onEpisodeCreate}
            onOpenAssetLibrary={() => vm.ui.openAssetLibrary()}
            onOpenSettings={() => vm.ui.setIsSettingsModalOpen(true)}
            onRefresh={() => vm.ui.onRefresh({ mode: 'full' })}
          />
        </WorkspaceStageRuntimeProvider>

        <WorkspaceAssetLibraryModal
          isOpen={vm.ui.isAssetLibraryOpen}
          onClose={vm.ui.closeAssetLibrary}
          assetsLoading={vm.ui.assetsLoading}
          assetsLoadingState={vm.ui.assetsLoadingState}
          hasCharacters={vm.project.projectCharacters.length > 0}
          hasLocations={vm.project.projectLocations.length > 0}
          projectId={projectId}
          isAnalyzingAssets={vm.execution.isAssetAnalysisRunning}
          focusCharacterId={vm.ui.assetLibraryFocusCharacterId}
          focusCharacterRequestId={vm.ui.assetLibraryFocusRequestId}
          triggerGlobalAnalyze={vm.ui.triggerGlobalAnalyzeOnOpen}
          onGlobalAnalyzeComplete={() => vm.ui.setTriggerGlobalAnalyzeOnOpen(false)}
          onAnalyzeAssets={vm.execution.handleAnalyzeAssets}
        />

        <ConfirmDialog
          show={vm.rebuild.showRebuildConfirm}
          type="warning"
          title={vm.rebuild.rebuildConfirmTitle}
          message={vm.rebuild.rebuildConfirmMessage}
          confirmText={vm.i18n.t('rebuildConfirm.confirm')}
          cancelText={vm.i18n.t('rebuildConfirm.cancel')}
          onConfirm={vm.rebuild.handleAcceptRebuildConfirm}
          onCancel={vm.rebuild.handleCancelRebuildConfirm}
        />

      </div>
    </div>
  )
}

export default function NovelPromotionWorkspace(props: NovelPromotionWorkspaceProps) {
  const { projectId, episodeId } = props
  return (
    <WorkspaceProvider projectId={projectId} episodeId={episodeId}>
      <NovelPromotionWorkspaceContent {...props} />
    </WorkspaceProvider>
  )
}
