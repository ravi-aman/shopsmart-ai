import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

type BatchStatus = 'ACTIVE' | 'DISCOUNTED' | 'OFFERED' | 'EXPIRED'

interface Batch {
  id: string
  batchNo: string
  productId: string
  productName: string
  price: number
  storage: string
  warehouseId: string
  quantityAvailable: number
  expiresAt: string
  daysLeft: number
  status: BatchStatus
  discountPercent: number
  offer: { id: string; status: string; partner: string; distanceMeters: number; emailStatus: string } | null
}

interface Rule {
  category: string
  tiers: { daysLeft: number; percent: number }[]
  offerToPartnersDaysLeft: number
  active: boolean
}

interface RunResult {
  expired: number
  discounted: number
  offered: number
  offersExpired: number
}

const statusStyle: Record<BatchStatus, string> = {
  ACTIVE: 'bg-canvas text-ink-muted',
  DISCOUNTED: 'bg-[#fdf3e2] text-stock-low',
  OFFERED: 'bg-ai-soft text-ai',
  EXPIRED: 'bg-[#fdecec] text-stock-out',
}

/** Near-expiry stock: tiered clearance discounts, expired lots blocked, surplus offered to partners within 3 km. */
export function ExpiryPage() {
  const [within, setWithin] = useState(7)
  const qc = useQueryClient()
  const batches = useQuery({ queryKey: ['expiry-batches', within], queryFn: () => api<Batch[]>(`/api/admin/expiry/batches?withinDays=${within}`), refetchInterval: 30_000 })
  const rules = useQuery({ queryKey: ['expiry-rules'], queryFn: () => api<Rule[]>('/api/admin/expiry/rules') })
  const run = useMutation({
    mutationFn: () => api<RunResult>('/api/admin/expiry/run', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expiry-batches'] }),
  })
  const counts = (batches.data ?? []).reduce<Record<string, number>>((m, b) => ((m[b.status] = (m[b.status] ?? 0) + 1), m), {})

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Expiry & surplus"
        description="The expiry job runs every 15 minutes: it raises clearance discounts by days left, blocks expired lots, and offers what can't sell in time to verified partners within 3 km."
        actions={
          <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className={buttonStyles.dark}>
            {run.isPending ? <Spinner /> : <Play className="size-4" aria-hidden />} Run expiry job now
          </button>
        }
      />
      {run.data && (
        <p className="rounded-md bg-[#e6f4ea] px-3 py-2 text-sm text-stock-in">
          Done: {run.data.discounted} discounts raised, {run.data.offered} partner offers sent, {run.data.expired} lots expired, {run.data.offersExpired} offers lapsed.
          {run.data.discounted + run.data.offered + run.data.expired + run.data.offersExpired === 0 && ' Nothing new — the job is idempotent.'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {(['ACTIVE', 'DISCOUNTED', 'OFFERED', 'EXPIRED'] as const).map((s) => (
          <div key={s} className="rounded-card border border-line bg-surface p-3">
            <p className="text-xs text-ink-subtle">{s === 'OFFERED' ? 'Held for partner' : s.charAt(0) + s.slice(1).toLowerCase()}</p>
            <p className="text-2xl font-bold tabular-nums">{counts[s] ?? 0}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Batches expiring within</h2>
          <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm">
            {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
        {batches.isError && <ErrorState title="Couldn’t load batches" detail={batches.error.message} />}
        {batches.data && (
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2.5">Product / batch</th>
                  <th className="px-3 py-2.5">Centre</th>
                  <th className="px-3 py-2.5 text-right">Units</th>
                  <th className="px-3 py-2.5 text-right">Days left</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Clearance price</th>
                  <th className="px-3 py-2.5">Partner offer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {batches.data.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{b.productName}</span>
                      <span className="block text-xs text-ink-subtle">{b.batchNo} · {b.storage?.toLowerCase()}</span>
                    </td>
                    <td className="px-3 py-2.5">{b.warehouseId}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{b.quantityAvailable}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', b.daysLeft <= 1 && 'font-semibold text-stock-out')}>{b.daysLeft <= 0 ? 'expired' : b.daysLeft}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', statusStyle[b.status])}>{b.status === 'OFFERED' ? 'HELD FOR PARTNER' : b.status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {b.discountPercent > 0 ? (
                        <>
                          {formatPrice(Math.round(b.price * (100 - b.discountPercent)) / 100)} <span className="text-xs text-stock-low">−{b.discountPercent}%</span>
                        </>
                      ) : (
                        formatPrice(b.price)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {b.offer ? (
                        <span>
                          <span className="font-medium">{b.offer.partner}</span> · {(b.offer.distanceMeters / 1000).toFixed(1)} km
                          <span className="block text-ink-subtle">{b.offer.status.toLowerCase().replace('_', ' ')} · email {b.offer.emailStatus?.toLowerCase()}</span>
                        </span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {batches.data.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">No batches expire in this window.</p>}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Discount rules</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {rules.data?.map((r) => (
            <li key={r.category} className="rounded-card border border-line bg-surface p-4 text-sm">
              <p className="font-semibold">{r.category === '*' ? 'All perishables (default)' : r.category}</p>
              <p className="mt-1 text-ink-muted">
                {[...r.tiers].sort((a, b) => b.daysLeft - a.daysLeft).map((t) => `≤${t.daysLeft} d → ${t.percent}%`).join(' · ')}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">Offered to partners at ≤{r.offerToPartnersDaysLeft} day{r.offerToPartnersDaysLeft === 1 ? '' : 's'} left.</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
