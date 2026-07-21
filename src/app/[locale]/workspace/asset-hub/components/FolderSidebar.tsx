'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface Folder {
    id: string
    name: string
}

interface FolderSidebarProps {
    folders: Folder[]
    selectedFolderId: string | null
    onSelectFolder: (folderId: string | null) => void
    onCreateFolder: () => void
    onEditFolder: (folder: Folder) => void
    onDeleteFolder: (folderId: string) => void
}

// 内联 SVG 图标
const FolderIcon = ({ className }: { className?: string }) => (
    <AppIcon name="folder" className={className} />
)

const PlusIcon = ({ className }: { className?: string }) => (
    <AppIcon name="plus" className={className} />
)

const PencilIcon = ({ className }: { className?: string }) => (
    <AppIcon name="edit" className={className} />
)

const TrashIcon = ({ className }: { className?: string }) => (
    <AppIcon name="trash" className={className} />
)

export function FolderSidebar({
    folders,
    selectedFolderId,
    onSelectFolder,
    onCreateFolder,
    onEditFolder,
    onDeleteFolder
}: FolderSidebarProps) {
    const t = useTranslations('assetHub')

    return (
        <div className="w-full">
            <div className="rounded-lg border border-white/10 bg-[#0b0c0a] p-4">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-stone-100">{t('folders')}</h3>
                    <button
                        onClick={onCreateFolder}
                        className="flex h-8 w-8 items-center justify-center rounded-md bg-[#f3e9cf] text-[#15130f] hover:bg-[#fff5d9]"
                        title={t('newFolder')}
                    >
                        <PlusIcon className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-1">
                    {/* 所有资产 */}
                    <button
                        onClick={() => onSelectFolder(null)}
                        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedFolderId === null
                                ? 'bg-[#e8d18a]/12 text-[#f3e9cf]'
                                : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
                            }`}
                    >
                        <FolderIcon className="h-4 w-4" />
                        <span className="truncate">{t('allAssets')}</span>
                    </button>

                    {/* 文件夹列表 */}
                    {folders.map((folder) => (
                        <div
                            key={folder.id}
                            className={`group flex items-center gap-2 rounded-md px-3 py-2 transition-colors ${selectedFolderId === folder.id
                                    ? 'bg-[#e8d18a]/12 text-[#f3e9cf]'
                                    : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
                                }`}
                        >
                            <button
                                onClick={() => onSelectFolder(folder.id)}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                            >
                                <FolderIcon className="h-4 w-4 flex-shrink-0" />
                                <span className="truncate">{folder.name}</span>
                            </button>

                            {/* 操作按钮 */}
                            <div className="hidden items-center gap-1 group-hover:flex">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onEditFolder(folder)
                                    }}
                                    className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-stone-300 hover:text-[#f3e9cf]"
                                    title={t('editFolder')}
                                >
                                    <PencilIcon className="h-3 w-3" />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDeleteFolder(folder.id)
                                    }}
                                    className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-rose-300 hover:text-rose-100"
                                    title={t('deleteFolder')}
                                >
                                    <TrashIcon className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ))}

                    {folders.length === 0 && (
                        <div className="py-4 text-center text-xs text-stone-600">
                            {t('noFolders')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
