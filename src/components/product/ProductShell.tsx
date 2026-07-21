'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useSession, signOut } from 'next-auth/react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { Link, usePathname } from '@/i18n/navigation'

type ProductShellMaxWidth = 'standard' | 'wide' | 'full'

interface ProductShellProps {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  maxWidth?: ProductShellMaxWidth
  contentClassName?: string
}

interface ProductNavItem {
  label: string
  href: '/workspace' | '/workspace/asset-hub' | '/profile'
  icon: AppIconName
  match: (pathname: string) => boolean
}

const NAV_ITEMS: ProductNavItem[] = [
  {
    label: '创作台',
    href: '/workspace',
    icon: 'clapperboard',
    match: (pathname) => pathname === '/workspace' || (pathname.startsWith('/workspace/') && !pathname.startsWith('/workspace/asset-hub')),
  },
  {
    label: '资产库',
    href: '/workspace/asset-hub',
    icon: 'folderCards',
    match: (pathname) => pathname.startsWith('/workspace/asset-hub'),
  },
  {
    label: '设置',
    href: '/profile',
    icon: 'settingsHexMinor',
    match: (pathname) => pathname.startsWith('/profile'),
  },
]

const PRODUCT_GLASS_TOKENS = {
  '--glass-bg-canvas': '#080907',
  '--glass-bg-surface': '#10110e',
  '--glass-bg-surface-strong': '#151613',
  '--glass-bg-surface-modal': '#151613',
  '--glass-bg-muted': 'rgba(255,255,255,0.055)',
  '--glass-bg-nav': '#0d0e0b',
  '--glass-text-primary': '#fafaf9',
  '--glass-text-secondary': '#d6d3d1',
  '--glass-text-tertiary': '#78716c',
  '--glass-text-on-accent': '#161512',
  '--glass-stroke-soft': 'rgba(255,255,255,0.08)',
  '--glass-stroke-base': 'rgba(255,255,255,0.10)',
  '--glass-stroke-strong': 'rgba(255,255,255,0.18)',
  '--glass-border': 'rgba(255,255,255,0.10)',
  '--glass-stroke-focus': 'rgba(232,209,138,0.70)',
  '--glass-stroke-danger': 'rgba(251,113,133,0.55)',
  '--glass-stroke-warning': 'rgba(251,191,36,0.55)',
  '--glass-stroke-success': 'rgba(52,211,153,0.55)',
  '--glass-shadow-sm': '0 1px 0 rgba(255,255,255,0.03)',
  '--glass-shadow-md': '0 14px 40px rgba(0,0,0,0.28)',
  '--glass-shadow-lg': '0 24px 70px rgba(0,0,0,0.34)',
  '--glass-shadow-modal': '0 30px 90px rgba(0,0,0,0.48)',
  '--glass-shadow-nav': '0 18px 60px rgba(0,0,0,0.32)',
  '--glass-blur-sm': '6px',
  '--glass-blur-md': '10px',
  '--glass-blur-lg': '14px',
  '--glass-blur-nav': '16px',
  '--glass-radius-xs': '6px',
  '--glass-radius-sm': '8px',
  '--glass-radius-md': '8px',
  '--glass-radius-lg': '8px',
  '--glass-radius-xl': '8px',
  '--glass-tone-neutral-bg': 'rgba(255,255,255,0.06)',
  '--glass-tone-neutral-fg': '#d6d3d1',
  '--glass-tone-info-bg': 'rgba(232,209,138,0.12)',
  '--glass-tone-info-fg': '#e8d18a',
  '--glass-tone-success-bg': 'rgba(52,211,153,0.12)',
  '--glass-tone-success-fg': '#6ee7b7',
  '--glass-tone-warning-bg': 'rgba(251,191,36,0.13)',
  '--glass-tone-warning-fg': '#facc15',
  '--glass-tone-danger-bg': 'rgba(251,113,133,0.13)',
  '--glass-tone-danger-fg': '#fda4af',
  '--glass-overlay-soft': 'rgba(0,0,0,0.46)',
  '--glass-overlay': 'rgba(0,0,0,0.68)',
  '--glass-overlay-strong': 'rgba(0,0,0,0.78)',
  '--glass-accent-from': '#f3e9cf',
  '--glass-accent-to': '#e8d18a',
  '--glass-accent-shadow-soft': 'rgba(232,209,138,0.16)',
  '--glass-accent-shadow-strong': 'rgba(232,209,138,0.24)',
  '--glass-focus-ring': 'rgba(232,209,138,0.14)',
  '--glass-focus-ring-strong': 'rgba(232,209,138,0.22)',
  '--glass-danger-ring': 'rgba(251,113,133,0.13)',
  '--glass-ghost-hover-bg': 'rgba(255,255,255,0.07)',
} as CSSProperties

function maxWidthClass(maxWidth: ProductShellMaxWidth) {
  if (maxWidth === 'full') return 'max-w-none'
  if (maxWidth === 'wide') return 'max-w-[1840px]'
  return 'max-w-[1500px]'
}

export default function ProductShell({
  title,
  subtitle,
  actions,
  children,
  maxWidth = 'standard',
  contentClassName = '',
}: ProductShellProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const normalizedPathname = pathname || ''

  return (
    <div className="min-h-screen bg-[#080907] text-stone-100" style={PRODUCT_GLASS_TOKENS} data-product-shell>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[76px] border-r border-white/10 bg-[#0d0e0b] lg:flex lg:flex-col">
        <div className="flex h-16 items-center justify-center border-b border-white/10">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f3e9cf] text-[#11110e]">
            <AppIcon name="clapperboard" className="h-5 w-5" />
          </div>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-2 px-2 py-4" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const active = item.match(normalizedPathname)
            return (
              <Link
                key={item.href}
                href={{ pathname: item.href }}
                title={item.label}
                aria-label={item.label}
                className={`flex h-12 w-12 items-center justify-center rounded-lg border transition-colors ${
                  active
                    ? 'border-[#e8d18a]/50 bg-[#e8d18a]/12 text-[#f3e9cf]'
                    : 'border-transparent text-stone-500 hover:border-white/10 hover:bg-white/[0.05] hover:text-stone-200'
                }`}
              >
                <AppIcon name={item.icon} className="h-5 w-5" />
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-2">
          <button
            type="button"
            title="退出登录"
            aria-label="退出登录"
            onClick={() => { void signOut({ callbackUrl: '/' }) }}
            className="flex h-12 w-12 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-white/[0.05] hover:text-stone-200"
          >
            <AppIcon name="logout" className="h-5 w-5" />
          </button>
        </div>
      </aside>

      <div className="lg:pl-[76px]">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080907]/92 backdrop-blur">
          <div className={`mx-auto flex min-h-16 w-full ${maxWidthClass(maxWidth)} items-center justify-between gap-4 px-4 sm:px-6 lg:px-8`}>
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f3e9cf] text-[#11110e] lg:hidden">
                <AppIcon name="clapperboard" className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[#c8a85f] sm:inline">
                    Waoo Studio
                  </span>
                  {title ? <span className="truncate text-sm font-semibold text-stone-100 sm:hidden">{title}</span> : null}
                </div>
                {subtitle ? <p className="mt-0.5 hidden truncate text-xs text-stone-500 sm:block">{subtitle}</p> : null}
              </div>
            </div>

            <nav className="hidden items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 md:flex" aria-label="顶部导航">
              {NAV_ITEMS.map((item) => {
                const active = item.match(normalizedPathname)
                return (
                  <Link
                    key={item.href}
                    href={{ pathname: item.href }}
                    className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[#f3e9cf] text-[#161512]'
                        : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
                    }`}
                  >
                    <AppIcon name={item.icon} className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            <div className="flex items-center gap-2">
              {actions}
              <a
                href="/api/admin/download-logs"
                download
                title="下载日志"
                aria-label="下载日志"
                className="hidden h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-stone-400 transition-colors hover:bg-white/[0.07] hover:text-stone-100 sm:inline-flex"
              >
                <AppIcon name="download" className="h-4 w-4" />
              </a>
              <div className="hidden sm:block">
                <LanguageSwitcher />
              </div>
              {session?.user?.name ? (
                <span className="hidden max-w-[140px] truncate rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-stone-400 xl:inline">
                  {session.user.name}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <main className={`mx-auto w-full ${maxWidthClass(maxWidth)} px-4 pb-24 pt-5 md:pb-5 sm:px-6 lg:px-8 ${contentClassName}`}>
          {(title || subtitle) ? (
            <div className="mb-5 hidden md:block">
              {title ? <h1 className="text-2xl font-semibold tracking-normal text-stone-50">{title}</h1> : null}
              {subtitle ? <p className="mt-2 text-sm leading-6 text-stone-500">{subtitle}</p> : null}
            </div>
          ) : null}
          {children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b0c0a]/95 px-3 py-2 backdrop-blur-xl md:hidden" aria-label="移动端导航">
        <div className="grid grid-cols-3 gap-2">
          {NAV_ITEMS.map((item) => {
            const active = item.match(normalizedPathname)
            return (
              <Link
                key={item.href}
                href={{ pathname: item.href }}
                className={`flex h-12 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-[#f3e9cf] text-[#161512]'
                    : 'text-stone-500 hover:bg-white/[0.06] hover:text-stone-100'
                }`}
              >
                <AppIcon name={item.icon} className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
