import { BookOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/features/auth/authStore'
import { cn } from '@/lib/cn'

const links = [{ to: '/admin/knowledge', label: 'Knowledge base', icon: BookOpen }] as { to: string; label: string; icon: typeof BookOpen; end?: boolean }[]

/** Back-office shell (Shopify Polaris–style left nav). Only ADMIN and OPS accounts get in. */
export function AdminLayout() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (user.role === 'CUSTOMER') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">Staff only</p>
        <p className="mt-1 text-sm text-ink-muted">Sign in with an admin or operations account to open the console.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-[200px_1fr]">
      <nav aria-label="Admin" className="flex gap-1 overflow-x-auto md:flex-col">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm',
                isActive ? 'bg-ink font-medium text-white' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
