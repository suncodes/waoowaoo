'use client'

import type { ReactNode } from 'react'
import { ProductMobileNav, ProductNavHeader, ProductNavRail } from './ProductNavigation'

type ProductShellMaxWidth = 'standard' | 'wide' | 'full'

interface ProductShellProps {
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  maxWidth?: ProductShellMaxWidth
  contentClassName?: string
}

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
  return (
    <div className="min-h-screen bg-[#0b0d0a] text-[#eff1e8]" data-product-shell>
      <ProductNavRail />
      <div className="lg:pl-[84px]">
        <ProductNavHeader title={title} subtitle={subtitle} actions={actions} />
        <main className={`mx-auto w-full ${maxWidthClass(maxWidth)} px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-8 ${contentClassName}`}>
          {children}
        </main>
      </div>
      <ProductMobileNav />
    </div>
  )
}
