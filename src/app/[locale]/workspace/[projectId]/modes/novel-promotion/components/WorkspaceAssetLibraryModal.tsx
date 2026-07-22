'use client'

import TaskStatusInline from '@/components/task/TaskStatusInline'
import type { TaskPresentationState } from '@/lib/task/presentation'
import ProductModalShell from '@/components/product/ProductModalShell'
import StudioProjectAssetLibrary from './studio/StudioProjectAssetLibrary'

interface WorkspaceAssetLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  assetsLoading: boolean
  assetsLoadingState: TaskPresentationState | null
  hasCharacters: boolean
  hasLocations: boolean
  projectId: string
  isAnalyzingAssets: boolean
  focusCharacterId: string | null
  focusCharacterRequestId: number
  triggerGlobalAnalyze: boolean
  onGlobalAnalyzeComplete: () => void
  onAnalyzeAssets?: () => Promise<unknown>
}

export default function WorkspaceAssetLibraryModal({
  isOpen,
  onClose,
  assetsLoading,
  assetsLoadingState,
  hasCharacters,
  hasLocations,
  projectId,
  isAnalyzingAssets,
  focusCharacterId,
  focusCharacterRequestId,
  triggerGlobalAnalyze,
  onGlobalAnalyzeComplete,
  onAnalyzeAssets,
}: WorkspaceAssetLibraryModalProps) {
  if (!isOpen) return null

  return (
    <ProductModalShell
      open={isOpen}
      onClose={onClose}
      size="xl"
      eyebrow="项目资产"
      title="项目资产库"
      description="管理当前项目提取和生成的角色、场景、道具及其定稿图片。"
    >
      <div data-asset-scroll-container="1">
          {assetsLoading && !hasCharacters && !hasLocations && (
            <div className="flex h-64 flex-col items-center justify-center animate-pulse text-stone-500">
              <TaskStatusInline state={assetsLoadingState} className="text-base [&>span]:text-base" />
            </div>
          )}
          <StudioProjectAssetLibrary
            projectId={projectId}
            isAnalyzingAssets={isAnalyzingAssets}
            focusCharacterId={focusCharacterId}
            focusCharacterRequestId={focusCharacterRequestId}
            triggerGlobalAnalyze={triggerGlobalAnalyze}
            onAnalyzeAssets={onAnalyzeAssets}
            onGlobalAnalyzeComplete={onGlobalAnalyzeComplete}
          />
      </div>
    </ProductModalShell>
  )
}
