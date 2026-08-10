'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import ProductShell from '@/components/product/ProductShell'
import ConfirmDialog from '@/components/ConfirmDialog'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import { shouldGuideToModelSetup } from '@/lib/workspace/model-setup'
import { Link, useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { validateProjectDraft } from '@/lib/projects/validation'
import { DEFAULT_ART_STYLE, DEFAULT_VIDEO_RATIO } from '@/lib/constants'
import {
  DEFAULT_VIDEO_PROFILE_PRESET,
  resolveVideoProfile,
  VIDEO_PROFILE_PRESET,
  type VideoProfilePreset,
} from '@/lib/video-profile'

interface ProjectStats {
  episodes: number
  images: number
  videos: number
  panels: number
  firstEpisodePreview: string | null
}

interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  videoProfile?: unknown
  totalCost?: number  // 项目总费用（CNY）
  stats?: ProjectStats
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const PAGE_SIZE = 7 // 加上新建项目按钮正好8个，4列布局下2行
const DEFAULT_BILLING_CURRENCY = 'CNY'

const PROJECT_TYPE_OPTIONS: Array<{
  value: VideoProfilePreset
  label: string
  description: string
  icon: 'film' | 'bookOpen'
}> = [
  {
    value: VIDEO_PROFILE_PRESET.AI_COMIC,
    label: 'AI 漫剧',
    description: '面向剧情冲突、角色表演和连续镜头的短剧生产流程。',
    icon: 'film',
  },
  {
    value: VIDEO_PROFILE_PRESET.BOOK_GUIDE,
    label: '书籍导读',
    description: '面向观点提炼、章节脉络和解说节奏的导读视频流程。',
    icon: 'bookOpen',
  },
]

function formatProjectCost(amount: number, currency = DEFAULT_BILLING_CURRENCY): string {
  if (currency === 'USD') return `$${amount.toFixed(2)}`
  return `¥${amount.toFixed(2)}`
}

function resolveProjectType(project: Project) {
  const profile = resolveVideoProfile(project.videoProfile)
  return PROJECT_TYPE_OPTIONS.find((option) => option.value === profile.preset) || PROJECT_TYPE_OPTIONS[0]
}

function MetricPill({
  icon,
  label,
  value,
}: {
  icon: 'bookOpen' | 'image' | 'video'
  label: string
  value: number
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
        <AppIcon name={icon} className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-stone-100">{value}</div>
    </div>
  )
}

function toProjectValidationMessage(
  issue: ReturnType<typeof validateProjectDraft>,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (!issue) return null

  switch (issue.code) {
    case 'PROJECT_NAME_REQUIRED':
      return t('validation.nameRequired')
    case 'PROJECT_NAME_TOO_LONG':
      return t('validation.nameTooLong')
    case 'PROJECT_DESCRIPTION_TOO_LONG':
      return t('validation.descriptionTooLong')
  }

  return null
}

export default function WorkspacePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    videoProfilePreset: DEFAULT_VIDEO_PROFILE_PRESET as VideoProfilePreset,
  })
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: ''
  })
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)

  // 分页和搜索状态
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [modelNotConfigured, setModelNotConfigured] = useState(false)

  const t = useTranslations('workspace')
  const tc = useTranslations('common')

  // 检查用户是否已登录
  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push({ pathname: '/auth/signin' })
      return
    }
  }, [session, status, router])

  // 获取项目列表
  const fetchProjects = useCallback(async (page: number = 1, search: string = '') => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: PAGE_SIZE.toString()
      })
      if (search.trim()) {
        params.set('search', search.trim())
      }

      const response = await apiFetch(`/api/projects?${params}`)
      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects)
        setPagination(data.pagination)
      }
    } catch (error) {
      _ulogError('获取项目失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载和搜索/分页变化时重新获取
  useEffect(() => {
    if (session) {
      fetchProjects(pagination.page, searchQuery)
    }
  }, [session, pagination.page, searchQuery, fetchProjects])

  // 搜索处理
  const handleSearch = () => {
    setSearchQuery(searchInput)
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  // 打开新建项目弹窗并检测模型配置
  const openCreateModal = useCallback(() => {
    setCreateError(null)
    setShowCreateModal(true)
    // 异步检测模型配置状态
    void (async () => {
      try {
        const res = await apiFetch('/api/user-preference')
        if (res.ok) {
          const payload: unknown = await res.json()
          setModelNotConfigured(shouldGuideToModelSetup(payload))
        }
      } catch {
        // 忽略检测失败
      }
    })()
  }, [])

  // 分页处理
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationMessage = toProjectValidationMessage(validateProjectDraft(formData), t)
    if (validationMessage) {
      setCreateError(validationMessage)
      return
    }

    setCreateError(null)
    setCreateLoading(true)
    try {
      const response = await apiFetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          videoRatio: DEFAULT_VIDEO_RATIO,
          artStyle: DEFAULT_ART_STYLE,
          videoProfile: resolveVideoProfile({ preset: formData.videoProfilePreset }),
        })
      })

      if (response.ok) {
        const createPayload: unknown = await response.json()
        const createdProject = createPayload && typeof createPayload === 'object'
          ? (createPayload as { project?: { id?: unknown } }).project
          : null
        const createdProjectId = typeof createdProject?.id === 'string' ? createdProject.id : ''
        let shouldOpenModelSetup = true
        const preferenceResponse = await apiFetch('/api/user-preference')
        if (preferenceResponse.ok) {
          const preferencePayload: unknown = await preferenceResponse.json()
          shouldOpenModelSetup = shouldGuideToModelSetup(preferencePayload)
        } else {
          _ulogError('获取用户偏好失败:', { status: preferenceResponse.status })
        }

        // 创建成功后刷新第一页
        setSearchQuery('')
        setSearchInput('')
        setPagination(prev => ({ ...prev, page: 1 }))
        void fetchProjects(1, '')
        setShowCreateModal(false)
        setFormData({
          name: '',
          description: '',
          videoProfilePreset: DEFAULT_VIDEO_PROFILE_PRESET,
        })

        if (shouldOpenModelSetup) {
          alert(t('analysisModelRequiredAfterCreate'))
          router.push({ pathname: '/profile' })
        } else if (createdProjectId) {
          router.push({ pathname: `/workspace/${createdProjectId}` })
        }
      } else {
        setCreateError(await readApiErrorMessage(response, t('createFailed')))
      }
    } catch (error) {
      _ulogError('创建项目失败:', error)
      setCreateError(error instanceof Error ? error.message : t('createFailed'))
    } finally {
      setCreateLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    // 转换为北京时间 (UTC+8)
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    return beijingTime.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    })
  }

  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProject) return

    const validationMessage = toProjectValidationMessage(validateProjectDraft(editFormData), t)
    if (validationMessage) {
      setEditError(validationMessage)
      return
    }

    setEditError(null)
    setCreateLoading(true)
    try {
      const response = await apiFetch(`/api/projects/${editingProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editFormData)
      })

      if (response.ok) {
        const data = await response.json()
        setProjects(projects.map(p => p.id === editingProject.id ? data.project : p))
        setShowEditModal(false)
        setEditingProject(null)
        setEditFormData({ name: '', description: '' })
      } else {
        setEditError(await readApiErrorMessage(response, t('updateFailed')))
      }
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t('updateFailed'))
    } finally {
      setCreateLoading(false)
    }
  }

  const handleDeleteProject = async () => {
    if (!projectToDelete) return

    setDeletingProjectId(projectToDelete.id)
    setShowDeleteConfirm(false)

    try {
      const response = await apiFetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // 删除成功后重新获取当前页
        fetchProjects(pagination.page, searchQuery)
      } else {
        alert(t('deleteFailed'))
      }
    } catch {
      alert(t('deleteFailed'))
    } finally {
      setDeletingProjectId(null)
      setProjectToDelete(null)
    }
  }

  const openDeleteConfirm = (project: Project, e: React.MouseEvent) => {
    e.preventDefault()  // 阻止 Link 导航
    e.stopPropagation()
    setProjectToDelete(project)
    setShowDeleteConfirm(true)
  }

  const cancelDelete = () => {
    setShowDeleteConfirm(false)
    setProjectToDelete(null)
  }

  const openEditModal = (project: Project, e: React.MouseEvent) => {
    e.preventDefault()  // 阻止 Link 导航
    e.stopPropagation()
    setEditingProject(project)
    setEditError(null)
    setEditFormData({
      name: project.name,
      description: project.description || ''
    })
    setShowEditModal(true)
  }

  if (status === 'loading' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080907]">
        <div className="text-sm text-stone-500">{tc('loading')}</div>
      </div>
    )
  }

  return (
    <ProductShell
      title="创作台"
      subtitle="按作品类型管理项目，从创意输入一路推进到分镜、视频和交付。"
      actions={(
        <button
          type="button"
          onClick={() => openCreateModal()}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#f3e9cf] px-3 text-sm font-semibold text-[#15130f] transition-colors hover:bg-[#fff5d9]"
        >
          <AppIcon name="plus" className="h-4 w-4" />
          新建项目
        </button>
      )}
      maxWidth="wide"
    >
      <div className="space-y-5">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-lg border border-white/10 bg-[#10110e] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c8a85f]">Production Console</p>
            <h2 className="mt-3 text-2xl font-semibold text-stone-50">项目生产总览</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-500">
              新建项目时先确定 AI 漫剧或书籍导读，后续文稿、视觉资产、分镜和镜头生产会按对应业务流程组织。
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="text-xs text-stone-500">项目数</div>
                <div className="mt-1 text-xl font-semibold text-stone-50">{pagination.total}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="text-xs text-stone-500">当前页</div>
                <div className="mt-1 text-xl font-semibold text-stone-50">{pagination.page}/{Math.max(1, pagination.totalPages)}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="text-xs text-stone-500">新建入口</div>
                <div className="mt-1 text-xl font-semibold text-stone-50">2 类</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#10110e] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-stone-50">查找项目</h2>
                <p className="mt-1 text-xs text-stone-500">按项目名称或描述检索。</p>
              </div>
              <AppIcon name="search" className="h-5 w-5 text-stone-600" />
            </div>
            <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('searchPlaceholder')}
                className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#0b0c0a] px-3 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#e8d18a]"
            />
            <button
                type="button"
              onClick={handleSearch}
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#15130f] hover:bg-[#fff5d9]"
            >
              {t('searchButton')}
            </button>
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setSearchQuery('')
                  setPagination(prev => ({ ...prev, page: 1 }))
                }}
                className="mt-3 inline-flex h-9 items-center rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-stone-300 hover:bg-white/[0.07]"
              >
                {t('clearButton')}
              </button>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="group flex min-h-[220px] flex-col justify-between rounded-lg border border-dashed border-[#e8d18a]/35 bg-[#14130f] p-5 text-left transition-colors hover:border-[#e8d18a]/70 hover:bg-[#19170f]"
          >
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#f3e9cf] text-[#15130f]">
                <AppIcon name="plus" className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-stone-50">创建新作品</h3>
              <p className="mt-2 text-sm leading-6 text-stone-500">先选择 AI 漫剧或书籍导读，再进入对应制作台。</p>
            </div>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#e8d18a]">
              开始创建
              <AppIcon name="arrowRight" className="h-4 w-4" />
            </span>
          </button>

          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="min-h-[220px] animate-pulse rounded-lg border border-white/10 bg-[#10110e] p-5">
                <div className="h-4 w-1/2 rounded bg-white/10" />
                <div className="mt-4 h-3 rounded bg-white/10" />
                <div className="mt-2 h-3 w-2/3 rounded bg-white/10" />
              </div>
            ))
          ) : (
            projects.map((project) => {
              const type = resolveProjectType(project)
              return (
                <Link
                  key={project.id}
                  href={{ pathname: `/workspace/${project.id}` }}
                  className="group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-lg border border-white/10 bg-[#10110e] p-5 transition-colors hover:border-[#e8d18a]/45 hover:bg-[#141510]"
                >
                  <div className="absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => openEditModal(project, e)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-[#0b0c0a] text-stone-300 hover:text-[#e8d18a]"
                      title={t('editProject')}
                    >
                      <AppIcon name="editSquare" className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => openDeleteConfirm(project, e)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-[#0b0c0a] text-rose-300 hover:text-rose-200"
                      title={t('deleteProject')}
                      disabled={deletingProjectId === project.id}
                    >
                      {deletingProjectId === project.id ? (
                        <TaskStatusInline
                          state={resolveTaskPresentationState({
                            phase: 'processing',
                            intent: 'process',
                            resource: 'text',
                            hasOutput: true,
                          })}
                          className="[&>span]:sr-only"
                        />
                      ) : (
                        <AppIcon name="trash" className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <div className="pr-16">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#e8d18a]/25 bg-[#e8d18a]/10 px-2 py-1 text-[11px] font-semibold text-[#e8d18a]">
                      <AppIcon name={type.icon} className="h-3.5 w-3.5" />
                      {type.label}
                    </div>
                    <h3 className="mt-4 line-clamp-2 text-lg font-semibold text-stone-50 group-hover:text-[#f3e9cf]">
                      {project.name}
                    </h3>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-500">
                      {project.description || project.stats?.firstEpisodePreview || '还没有内容，进入项目后从项目简报开始。'}
                    </p>
                  </div>

                  <div>
                    <div className="mt-5 grid grid-cols-3 gap-2">
                      <MetricPill icon="bookOpen" label="剧集" value={project.stats?.episodes || 0} />
                      <MetricPill icon="image" label="图片" value={project.stats?.images || 0} />
                      <MetricPill icon="video" label="视频" value={project.stats?.videos || 0} />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-stone-600">
                      <span className="inline-flex items-center gap-1">
                        <AppIcon name="clock" className="h-3 w-3" />
                        {formatDate(project.createdAt)}
                      </span>
                      {project.totalCost !== undefined && project.totalCost > 0 ? (
                        <span className="font-mono text-stone-400">{formatProjectCost(project.totalCost)}</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </section>

        {!loading && projects.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/15 bg-[#10110e] px-6 py-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-white/[0.04]">
              <AppIcon name="folderCards" className="h-7 w-7 text-stone-500" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-stone-50">
              {searchQuery ? t('noResults') : t('noProjects')}
            </h3>
            <p className="mt-2 text-sm text-stone-500">
              {searchQuery ? t('noResultsDesc') : t('noProjectsDesc')}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={() => openCreateModal()}
                className="mt-5 inline-flex h-10 items-center rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#15130f] hover:bg-[#fff5d9]"
              >
                {t('newProject')}
              </button>
            )}
          </div>
        )}

        {!loading && pagination.totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-stone-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AppIcon name="chevronLeft" className="h-5 w-5" />
            </button>

            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
              .filter(page => {
                return page === 1 ||
                  page === pagination.totalPages ||
                  Math.abs(page - pagination.page) <= 2
              })
              .map((page, index, array) => (
                <span key={page} className="flex items-center">
                  {index > 0 && array[index - 1] !== page - 1 && (
                    <span className="px-2 text-stone-600">...</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePageChange(page)}
                    className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold ${page === pagination.page
                      ? 'bg-[#f3e9cf] text-[#15130f]'
                      : 'border border-white/10 bg-white/[0.03] text-stone-300 hover:bg-white/[0.07]'
                    }`}
                  >
                    {page}
                  </button>
                </span>
              ))}

            <button
              type="button"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-stone-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <AppIcon name="chevronRight" className="h-5 w-5" />
            </button>

            <span className="ml-4 text-sm text-stone-500">
              {t('totalProjects', { count: pagination.total })}
            </span>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-[#10110e] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c8a85f]">New Project</p>
                <h2 className="mt-2 text-xl font-semibold text-stone-50">{t('createProject')}</h2>
                <p className="mt-1 text-sm text-stone-500">选择作品类型后，系统会按对应业务流程生成内容和视觉资产。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-stone-400 hover:bg-white/[0.06] hover:text-stone-100"
                aria-label={tc('cancel')}
              >
                <AppIcon name="close" className="h-4 w-4" />
              </button>
            </div>
            {modelNotConfigured && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-amber-100">
                <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="text-xs leading-5">
                  {t('modelNotConfigured.before')}
                  <Link
                    href={{ pathname: '/profile' }}
                    className="mx-0.5 font-semibold underline underline-offset-2 hover:text-amber-50"
                    onClick={() => setShowCreateModal(false)}
                  >
                    {t('modelNotConfigured.link')}
                  </Link>
                  {t('modelNotConfigured.after')}
                </span>
              </div>
            )}
            <form onSubmit={handleCreateProject} className="space-y-5">
              <div>
                <div className="mb-2 text-sm font-semibold text-stone-100">作品类型</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PROJECT_TYPE_OPTIONS.map((option) => {
                    const selected = formData.videoProfilePreset === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, videoProfilePreset: option.value })}
                        className={`rounded-lg border p-4 text-left transition-colors ${selected
                          ? 'border-[#e8d18a]/70 bg-[#e8d18a]/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-md ${selected ? 'bg-[#f3e9cf] text-[#15130f]' : 'bg-white/[0.06] text-stone-400'}`}>
                            <AppIcon name={option.icon} className="h-5 w-5" />
                          </span>
                          <span className="text-sm font-semibold text-stone-50">{option.label}</span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-stone-500">{option.description}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mb-4">
                <label htmlFor="name" className="mb-2 block text-sm font-semibold text-stone-100">
                  {t('projectName')} *
                </label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value })
                    if (createError) {
                      setCreateError(null)
                    }
                  }}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#0b0c0a] px-3 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#e8d18a]"
                  placeholder={t('projectNamePlaceholder')}
                  maxLength={100}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="description" className="mb-2 block text-sm font-semibold text-stone-100">
                  {t('projectDescription')}
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value })
                    if (createError) {
                      setCreateError(null)
                    }
                  }}
                  className="w-full resize-y rounded-md border border-white/10 bg-[#0b0c0a] px-3 py-2 text-sm leading-6 text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#e8d18a]"
                  placeholder={t('projectDescriptionPlaceholder')}
                  rows={3}
                  maxLength={500}
                />
              </div>
              {createError && (
                <p className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                  {createError}
                </p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setCreateError(null)
                    setFormData({
                      name: '',
                      description: '',
                      videoProfilePreset: DEFAULT_VIDEO_PROFILE_PRESET,
                    })
                  }}
                  className="inline-flex h-10 items-center rounded-md border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-stone-200 hover:bg-white/[0.07]"
                  disabled={createLoading}
                >
                  {tc('cancel')}
                </button>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#15130f] hover:bg-[#fff5d9] disabled:opacity-50"
                  disabled={createLoading || !formData.name.trim()}
                >
                  {createLoading ? t('creating') : t('createProject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && editingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#10110e] p-6">
            <h2 className="mb-4 text-xl font-semibold text-stone-50">{t('editProject')}</h2>
            <form onSubmit={handleEditProject}>
              <div className="mb-4">
                <label htmlFor="edit-name" className="mb-2 block text-sm font-semibold text-stone-100">
                  {t('projectName')} *
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => {
                    setEditFormData({ ...editFormData, name: e.target.value })
                    if (editError) {
                      setEditError(null)
                    }
                  }}
                  className="h-10 w-full rounded-md border border-white/10 bg-[#0b0c0a] px-3 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#e8d18a]"
                  placeholder={t('projectNamePlaceholder')}
                  maxLength={100}
                  required
                />
              </div>
              <div className="mb-6">
                <label htmlFor="edit-description" className="mb-2 block text-sm font-semibold text-stone-100">
                  {t('projectDescription')}
                </label>
                <textarea
                  id="edit-description"
                  value={editFormData.description}
                  onChange={(e) => {
                    setEditFormData({ ...editFormData, description: e.target.value })
                    if (editError) {
                      setEditError(null)
                    }
                  }}
                  className="w-full resize-y rounded-md border border-white/10 bg-[#0b0c0a] px-3 py-2 text-sm leading-6 text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#e8d18a]"
                  placeholder={t('projectDescriptionPlaceholder')}
                  rows={3}
                  maxLength={500}
                />
              </div>
              {editError && (
                <p className="mb-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                  {editError}
                </p>
              )}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingProject(null)
                    setEditError(null)
                    setEditFormData({ name: '', description: '' })
                  }}
                  className="inline-flex h-10 items-center rounded-md border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-stone-200 hover:bg-white/[0.07]"
                  disabled={createLoading}
                >
                  {tc('cancel')}
                </button>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#15130f] hover:bg-[#fff5d9] disabled:opacity-50"
                  disabled={createLoading || !editFormData.name.trim()}
                >
                  {createLoading ? t('saving') : tc('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      <ConfirmDialog
        show={showDeleteConfirm}
        title={t('deleteProject')}
        message={t('deleteConfirm', { name: projectToDelete?.name || '' })}
        confirmText={tc('delete')}
        cancelText={tc('cancel')}
        type="danger"
        onConfirm={handleDeleteProject}
        onCancel={cancelDelete}
      />
    </ProductShell>
  )
}
