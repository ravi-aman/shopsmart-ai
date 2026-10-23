import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellRing, Crown, Ruler, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { buttonStyles, Spinner } from '@/components/Bits'
import { ProductCard } from '@/components/ProductCard'
import { useAuth } from '@/features/auth/authStore'
import { inputClass } from '@/features/auth/AuthPages'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'
import type { ProductDetail, ProductSummary } from '@/lib/types'

interface StockRequest {
  id: string
  productId: string
  status: 'ACTIVE' | 'NOTIFIED' | 'CANCELLED'
}

/** "Notify me" for out-of-stock products; the server sends one in-app + email alert on restock. */
export function NotifyMe({ productId }: { productId: string }) {
  const user = useAuth((s) => s.user)
  const qc = useQueryClient()
  const mine = useQuery({ queryKey: ['stock-requests'], queryFn: () => api<StockRequest[]>('/api/me/stock-requests'), enabled: !!user })
  const active = mine.data?.some((r) => r.productId === productId && r.status === 'ACTIVE')
  const toggle = useMutation({
    mutationFn: () => api(`/api/products/${productId}/stock-requests`, { method: active ? 'DELETE' : 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-requests'] }),
  })

  if (!user) {
    return (
      <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className={cn(buttonStyles.secondary, 'w-full')}>
        <Bell className="size-4" aria-hidden /> Sign in to get a restock alert
      </Link>
    )
  }
  return (
    <div>
      <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending || mine.isPending} className={cn(buttonStyles.secondary, 'w-full', active && 'border-stock-in text-stock-in')}>
        {toggle.isPending ? <Spinner /> : active ? <BellRing className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {active ? 'We’ll notify you — tap to cancel' : 'Notify me when it’s back'}
      </button>
      {toggle.isError && <p className="mt-1 text-xs text-stock-out">{toggle.error.message}</p>}
    </div>
  )
}

interface FitAdvice {
  supported: boolean
  message: string
  needsMeasurements?: string[]
  suggestedSize?: string
  alternativeSize?: string | null
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  notes?: string[]
}

interface Bundle {
  companions: ProductSummary[]
  subtotal: number
  estimatedTotal: number
  note: string
}

const confidenceTone = { HIGH: 'text-stock-in', MEDIUM: 'text-stock-low', LOW: 'text-stock-out' } as const

/** Premium-only helpers: size advice from the manufacturer chart and a "complete the set" bundle. */
export function PremiumTools({ detail }: { detail: ProductDetail }) {
  const user = useAuth((s) => s.user)
  const hasChart = !!detail.sizeChart
  const premium = user?.membershipTier === 'PREMIUM'
  return (
    <section className="mt-6 rounded-card border border-ai/25 bg-ai-soft/40 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Crown className="size-4 text-ai" aria-hidden /> Premium shopping tools
      </h2>
      {!premium ? (
        <p className="mt-1 text-sm text-ink-muted">
          {hasChart ? 'Size advice and “complete the set” bundles are' : '“Complete the set” bundles are'} part of Premium.{' '}
          {user ? 'Upgrade your membership to use them.' : <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link>}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {hasChart && <FitAdvisor productId={detail.product.id} dims={Object.keys(Object.values(detail.sizeChart!)[0] ?? {})} />}
          <BundleBuilder productId={detail.product.id} />
        </div>
      )}
    </section>
  )
}

const dimLabel: Record<string, string> = { chestCm: 'Chest (cm)', waistCm: 'Waist (cm)', footLengthCm: 'Foot length (cm)' }

function FitAdvisor({ productId, dims }: { productId: string; dims: string[] }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const fit = useMutation({
    mutationFn: () =>
      api<FitAdvice>('/api/ai/premium/fit', {
        method: 'POST',
        body: JSON.stringify({ productId, measurements: Object.fromEntries(dims.map((d) => [d, values[d] ? Number(values[d]) : null])) }),
      }),
  })
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold"><Ruler className="size-3.5" aria-hidden /> Find my size</p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          fit.mutate()
        }}
      >
        {dims.map((d) => (
          <label key={d} className="text-xs text-ink-muted">
            {dimLabel[d] ?? d}
            <input type="number" inputMode="decimal" step="0.1" min={10} max={250} value={values[d] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [d]: e.target.value }))} placeholder="saved" className={cn(inputClass, 'mt-1 w-28')} />
          </label>
        ))}
        <button type="submit" disabled={fit.isPending} className={buttonStyles.secondary}>
          {fit.isPending ? <Spinner /> : 'Suggest size'}
        </button>
      </form>
      <p className="mt-1 text-[11px] text-ink-subtle">Leave blank to use the measurements saved on your account.</p>
      {fit.isError && <p className="mt-2 text-xs text-stock-out">{fit.error.message}</p>}
      {fit.data && (
        <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm">
          <p className="font-semibold">
            {fit.data.message}
            {fit.data.confidence && <span className={cn('ml-2 text-xs', confidenceTone[fit.data.confidence])}>{fit.data.confidence.toLowerCase()} confidence</span>}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
            {fit.data.notes?.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function BundleBuilder({ productId }: { productId: string }) {
  const bundle = useMutation({ mutationFn: () => api<Bundle>('/api/ai/premium/bundle', { method: 'POST', body: JSON.stringify({ productId }) }) })
  return (
    <div>
      <button type="button" onClick={() => bundle.mutate()} disabled={bundle.isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ai hover:underline">
        {bundle.isPending ? <Spinner /> : <Sparkles className="size-3.5" aria-hidden />} Complete the set
      </button>
      {bundle.isError && <p className="mt-1 text-xs text-stock-out">{bundle.error instanceof ApiError ? bundle.error.message : 'Could not build a bundle'}</p>}
      {bundle.data && (
        <div className="mt-2">
          {bundle.data.companions.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {bundle.data.companions.map((c) => (
                <li key={c.id}>
                  <ProductCard product={c} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm">
            {bundle.data.companions.length > 0 && <>Together: <strong>{formatPrice(bundle.data.estimatedTotal)}</strong>. </>}
            <span className="text-xs text-ink-muted">{bundle.data.note}</span>
          </p>
        </div>
      )}
    </div>
  )
}
