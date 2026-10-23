import { Heart, Home, LayoutGrid, MapPin, ShoppingCart, Sparkles, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { departments } from '@/app/categories'
import { AssistantDrawer } from '@/features/assistant/AssistantDrawer'
import { useAssistant } from '@/features/assistant/assistantStore'
import { SearchBox } from '@/app/SearchBox'
import { useAuth } from '@/features/auth/authStore'
import { useCart } from '@/features/cart/useCart'
import { CompareTray } from '@/features/compare/CompareTray'
import { cn } from '@/lib/cn'
import { regionLabel } from '@/lib/format'

export function AppLayout() {
  const user = useAuth((s) => s.user)
  const { itemCount } = useCart()
  const location = useLocation()
  const setAssistantOpen = useAssistant((st) => st.setOpen)

  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollRestoration />
      <header className="sticky top-0 z-40">
        <div className="bg-header text-white">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:gap-4">
            <Link to="/" className="shrink-0 text-xl font-bold tracking-tight">
              shop<span className="text-accent">smart</span>
            </Link>

            <div className="hidden shrink-0 items-center gap-1.5 px-1 text-xs leading-tight text-white/75 md:flex">
              <MapPin className="size-4" aria-hidden />
              <span>
                Deliver to
                <span className="block text-sm font-semibold text-white">
                  {user ? (regionLabel[user.region] ?? user.region) : 'West India'}
                </span>
              </span>
            </div>

            <SearchBox key={location.pathname === '/search' ? location.search : 'search'} />

            <nav className="hidden shrink-0 items-center gap-1 text-sm md:flex">
              <HeaderLink
                to={user ? '/account' : '/login'}
                icon={<User className="size-5" aria-hidden />}
                label={user ? user.name.split(' ')[0] : 'Sign in'}
                sub={user ? `${user.membershipTier.toLowerCase()} member` : undefined}
              />
              <HeaderLink to="/wishlist" icon={<Heart className="size-5" aria-hidden />} label="Wishlist" />
              <HeaderLink
                to="/cart"
                icon={
                  <span className="relative">
                    <ShoppingCart className="size-5" aria-hidden />
                    {itemCount > 0 && (
                      <span className="absolute -right-2 -top-2 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold">
                        {itemCount}
                      </span>
                    )}
                  </span>
                }
                label="Cart"
              />
            </nav>
          </div>
        </div>

        <div className="border-b border-line bg-surface">
          <div className="mx-auto flex h-11 max-w-7xl items-center gap-1 overflow-x-auto px-4 text-sm">
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ai-soft px-3 py-1 font-medium text-ai hover:bg-ai hover:text-white"
            >
              <Sparkles className="size-4" aria-hidden />
              Ask ShopSmart AI
            </button>
            {departments.map((d) => (
              <NavLink
                key={d.slug}
                to={`/c/${d.slug}`}
                className={({ isActive }) =>
                  cn(
                    'shrink-0 rounded-md px-2.5 py-1 text-ink-muted hover:bg-canvas hover:text-ink',
                    isActive && 'bg-canvas font-medium text-ink',
                  )
                }
              >
                {d.name}
              </NavLink>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface pb-16 md:pb-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-ink-subtle">
          <span>ShopSmart AI — hackathon build</span>
          <Link to="/status" className="hover:text-ink">
            System status
          </Link>
        </div>
      </footer>

      <CompareTray />
      <AssistantDrawer />

      {/* mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface md:hidden" aria-label="Primary">
        <BottomLink to="/" icon={<Home className="size-5" />} label="Home" end />
        <BottomLink to="/c/electronics" icon={<LayoutGrid className="size-5" />} label="Shop" />
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-ai"
        >
          <Sparkles className="size-5" />
          Ask AI
        </button>
        <BottomLink
          to="/cart"
          icon={
            <span className="relative">
              <ShoppingCart className="size-5" />
              {itemCount > 0 && (
                <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {itemCount}
                </span>
              )}
            </span>
          }
          label="Cart"
        />
        <BottomLink to={user ? '/account' : '/login'} icon={<User className="size-5" />} label={user ? 'Account' : 'Sign in'} />
      </nav>
    </div>
  )
}

function HeaderLink({ to, icon, label, sub }: { to: string; icon: ReactNode; label: string; sub?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10">
      {icon}
      <span className="hidden leading-tight lg:block">
        {sub && <span className="block text-[10px] capitalize text-white/60">{sub}</span>}
        {label}
      </span>
    </Link>
  )
}

function BottomLink({ to, icon, label, end }: { to: string; icon: ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'font-semibold text-accent' : 'text-ink-muted')
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
