'use client'

import type { ReactNode } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { Link, usePathname } from '@/i18n/navigation'

export type ProductNavItem = {
  key: 'workspace' | 'assetHub' | 'profile'
  href: '/workspace' | '/workspace/asset-hub' | '/profile'
  icon: AppIconName
}

export const PRODUCT_NAV_ITEMS: ProductNavItem[] = [
  { key: 'workspace', href: '/workspace', icon: 'clapperboard' },
  { key: 'assetHub', href: '/workspace/asset-hub', icon: 'folderCards' },
  { key: 'profile', href: '/profile', icon: 'settingsHexMinor' },
]

export function isProductNavActive(item: ProductNavItem, pathname: string): boolean {
  if (item.key === 'workspace') {
    return pathname === '/workspace' || (pathname.startsWith('/workspace/') && !pathname.startsWith('/workspace/asset-hub'))
  }
  if (item.key === 'assetHub') return pathname.startsWith('/workspace/asset-hub')
  return pathname.startsWith('/profile')
}

function navLabel(t: (key: 'workspace' | 'assetHub' | 'profile') => string, item: ProductNavItem) {
  return t(item.key)
}

export function ProductNavRail() {
  const pathname = usePathname() || ''
  const t = useTranslations('nav')
  const session = useSession()

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[84px] border-r border-[#252820] bg-[#10120f] lg:flex lg:flex-col">
      <div className="flex h-[72px] items-center justify-center border-b border-[#252820]">
        <Link
          href={{ pathname: '/workspace' }}
          aria-label={t('workspace')}
          className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e8d18a] text-[#171810] transition-transform hover:scale-[1.03]"
        >
          <AppIcon name="clapperboard" className="h-5 w-5" />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col items-center gap-2 px-3 py-5" aria-label="产品导航">
        {PRODUCT_NAV_ITEMS.map((item) => {
          const active = isProductNavActive(item, pathname)
          const label = navLabel((key) => t(key), item)
          return (
            <Link
              key={item.key}
              href={{ pathname: item.href }}
              title={label}
              aria-label={label}
              className={`relative flex h-12 w-12 items-center justify-center rounded-md border transition-colors ${active
                ? 'border-[#e8d18a]/55 bg-[#e8d18a]/12 text-[#f3e9cf]'
                : 'border-transparent text-[#777d70] hover:border-[#30352b] hover:bg-[#1a1d18] hover:text-[#eff1e8]'
              }`}
            >
              {active ? <span className="absolute left-[-13px] h-5 w-0.5 bg-[#e8d18a]" /> : null}
              <AppIcon name={item.icon} className="h-5 w-5" />
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-[#252820] p-3">
        <button
          type="button"
          title={t('logout')}
          aria-label={t('logout')}
          onClick={() => { void signOut({ callbackUrl: '/' }) }}
          disabled={!session.data}
          className="flex h-12 w-full items-center justify-center rounded-md text-[#777d70] transition-colors hover:bg-[#1a1d18] hover:text-[#eff1e8] disabled:opacity-40"
        >
          <AppIcon name="logout" className="h-5 w-5" />
        </button>
      </div>
    </aside>
  )
}

export function ProductNavHeader({
  title,
  subtitle,
  actions,
}: {
  title?: string
  subtitle?: string
  actions?: ReactNode
}) {
  const pathname = usePathname() || ''
  const t = useTranslations('nav')
  const session = useSession()

  return (
    <header className="sticky top-0 z-30 border-b border-[#252820] bg-[#10120f]/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-[72px] w-full max-w-[1840px] items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={{ pathname: '/workspace' }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#e8d18a] text-[#171810] lg:hidden">
            <AppIcon name="clapperboard" className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] font-bold uppercase tracking-[0.2em] text-[#b99b58] sm:inline">WAOO STUDIO</span>
              {title ? <span className="truncate text-sm font-semibold text-[#eff1e8] sm:text-base">{title}</span> : null}
            </div>
            {subtitle ? <p className="mt-1 hidden max-w-[460px] truncate text-xs text-[#777d70] md:block">{subtitle}</p> : null}
          </div>
        </div>

        <nav className="hidden items-center gap-1 border border-[#2a2f25] bg-[#151813] p-1 md:flex" aria-label="产品导航">
          {PRODUCT_NAV_ITEMS.map((item) => {
            const active = isProductNavActive(item, pathname)
            return (
              <Link
                key={item.key}
                href={{ pathname: item.href }}
                className={`inline-flex h-9 items-center gap-2 px-3 text-sm font-medium transition-colors ${active
                  ? 'bg-[#e8d18a] text-[#171810]'
                  : 'text-[#9ca294] hover:bg-[#20241d] hover:text-[#eff1e8]'
                }`}
              >
                <AppIcon name={item.icon} className="h-4 w-4" />
                {navLabel((key) => t(key), item)}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          {actions}
          <a
            href="/api/admin/download-logs"
            download
            title={t('downloadLogs')}
            aria-label={t('downloadLogs')}
            className="hidden h-9 w-9 items-center justify-center border border-[#2a2f25] bg-[#151813] text-[#9ca294] transition-colors hover:bg-[#20241d] hover:text-[#eff1e8] sm:inline-flex"
          >
            <AppIcon name="download" className="h-4 w-4" />
          </a>
          <div className="hidden sm:block"><LanguageSwitcher /></div>
          {session.data?.user?.name ? <span className="hidden max-w-[150px] truncate border border-[#2a2f25] bg-[#151813] px-3 py-2 text-xs text-[#9ca294] xl:inline">{session.data.user.name}</span> : null}
        </div>
      </div>
    </header>
  )
}

export function ProductMobileNav() {
  const pathname = usePathname() || ''
  const t = useTranslations('nav')
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#252820] bg-[#10120f]/96 px-3 py-2 backdrop-blur-md md:hidden" aria-label="移动端产品导航">
      <div className="grid grid-cols-3 gap-2">
        {PRODUCT_NAV_ITEMS.map((item) => {
          const active = isProductNavActive(item, pathname)
          return (
            <Link
              key={item.key}
              href={{ pathname: item.href }}
              className={`flex h-12 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${active
                ? 'bg-[#e8d18a] text-[#171810]'
                : 'text-[#777d70] hover:bg-[#20241d] hover:text-[#eff1e8]'
              }`}
            >
              <AppIcon name={item.icon} className="h-4 w-4" />
              {navLabel((key) => t(key), item)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
