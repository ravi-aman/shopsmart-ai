import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { ActionCard, type OpsAction } from '@/features/admin/OverviewPage'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

type Risk = 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OK' | 'OVERSTOCK'

interface RiskRow {
  position: {
    productId: string
    productName: string
    category: string
    warehouseId: string
    city: string
    available: number
    dailySales: number
    daysOfCover: number | null
    risk: Risk
  }
  recommendation: {
    type: 'TRANSFER' | 'REORDER'
    productId: string
    productName: string
    fromWarehouse: string | null
    toWarehouse: string
    quantity: number
    rationale: string
  }
}

interface Promotion {
  id: string
  code: string
  description: string
  value: number
  productName: string | null
  status: 'DRAFT' | 'ACTIVE' | 'ENDED'
  createdBy: 'HUMAN' | 'AGENT'
  rationale: string | null
  endsAt: string
}

interface Overstock {
  productId: string
  productName: string
  category: string
  price: number
  available: number
  dailySales: number
  daysOfCover: number | null
}

const riskStyle: Record<Risk, string> = {
  OUT_OF_STOCK: 'bg-[#fdecec] text-stock-out',
  CRITICAL: 'bg-[#fdecec] text-stock-out',
  LOW: 'bg-[#fdf3e2] text-stock-low',
  OK: 'bg-canvas text-ink-muted',
  OVERSTOCK: 'bg-ai-soft text-ai',
}

export function InventoryPage() {
  const forecast = useQuery({ queryKey: ['ops-forecast'], queryFn: () => api<RiskRow[]>('/api/ops/forecast') })
  const overstock = useQuery({ queryKey: ['ops-overstock'], queryFn: () => api<Overstock[]>('/api/ops/overstock') })
  const promotions = useQuery({ queryKey: ['ops-promotions'], queryFn: () => api<Promotion[]>('/api/ops/promotions') })
  const qc = useQueryClient()
  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'end' }) => api(`/api/ops/promotions/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-promotions'] }),
  })

  return (
    <div className="space-y-8">
      <div>
        <AdminPageHeader
          title="Inventory & forecast"
          description="Days of cover = available stock ÷ 14-day average daily sales, compared with a 7-day replenishment lead time."
        />
        {forecast.isError && <ErrorState title="Couldn’t load forecast" detail={forecast.error.message} />}
        {forecast.data && (
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-3 py-2.5">Centre</th>
                  <th className="px-3 py-2.5 text-right">Available</th>
                  <th className="px-3 py-2.5 text-right">Sales/day</th>
                  <th className="px-3 py-2.5 text-right">Cover</th>
                  <th className="px-3 py-2.5">Risk</th>
                  <th className="px-3 py-2.5">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {forecast.data.slice(0, 40).map((r) => (
                  <tr key={r.position.productId + r.position.warehouseId}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{r.position.productName}</span>
                      <span className="block text-xs text-ink-subtle">{r.position.productId} · {r.position.category}</span>
                    </td>
                    <td className="px-3 py-2.5">{r.position.city}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.position.available}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.position.dailySales}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.position.daysOfCover == null ? '—' : `${r.position.daysOfCover} d`}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', riskStyle[r.position.risk])}>{r.position.risk.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.recommendation.type === 'TRANSFER' ? (
                        <TransferButton row={r} />
                      ) : (
                        <span className="text-ink-muted">Reorder {r.recommendation.quantity} from supplier</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {forecast.data.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">No stock risks right now.</p>}
          </div>
        )}
      </div>

      <div>
        <AdminPageHeader title="Promotions" description="Drafts are invisible to shoppers until activated." />
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-card border border-line bg-surface p-4">
            <p className="text-sm font-semibold">Slow sellers with excess stock</p>
            <ul className="mt-3 grid gap-2">
              {overstock.data?.slice(0, 4).map((o) => {
                const pct = o.daysOfCover == null || o.daysOfCover > 120 ? 15 : 10
                const action: OpsAction = {
                  type: 'PROMOTION',
                  productId: o.productId,
                  productName: o.productName,
                  fromWarehouse: null,
                  toWarehouse: null,
                  quantity: null,
                  discountPercent: pct,
                  rationale: `${o.available} units, ${o.daysOfCover == null ? 'no sales in 14 days' : `${o.daysOfCover} days of cover`} at ${formatPrice(o.price)}.`,
                }
                return (
                  <li key={o.productId}>
                    <ActionCard action={action} auditId={null} />
                  </li>
                )
              })}
              {overstock.data?.length === 0 && <li className="text-sm text-ink-muted">Nothing is overstocked.</li>}
            </ul>
          </section>
          <section className="rounded-card border border-line bg-surface">
            <p className="border-b border-line px-4 py-3 text-sm font-semibold">All promotions</p>
            <ul className="divide-y divide-line">
              {promotions.data?.map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.description}</p>
                    <p className="text-xs text-ink-subtle">
                      {p.code} · by {p.createdBy.toLowerCase()} · ends {new Date(p.endsAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', p.status === 'ACTIVE' ? 'bg-[#e6f4ea] text-stock-in' : 'bg-canvas text-ink-muted')}>
                    {p.status}
                  </span>
                  {p.status === 'DRAFT' && (
                    <button type="button" onClick={() => setStatus.mutate({ id: p.id, action: 'activate' })} className="text-xs font-semibold text-accent hover:underline">
                      Activate
                    </button>
                  )}
                  {p.status === 'ACTIVE' && (
                    <button type="button" onClick={() => setStatus.mutate({ id: p.id, action: 'end' })} className="text-xs font-semibold text-ink-muted hover:underline">
                      End
                    </button>
                  )}
                </li>
              ))}
              {promotions.data?.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">No promotions yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function TransferButton({ row }: { row: RiskRow }) {
  const qc = useQueryClient()
  const rec = row.recommendation
  const transfer = useMutation({
    mutationFn: () =>
      api('/api/ops/transfers', {
        method: 'POST',
        body: JSON.stringify({ productId: rec.productId, fromWarehouse: rec.fromWarehouse, toWarehouse: rec.toWarehouse, quantity: rec.quantity }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ops-forecast'] }),
  })
  return (
    <span className="flex items-center gap-2">
      <span className="text-ink-muted" title={rec.rationale}>
        Move {rec.quantity} from {rec.fromWarehouse}
      </span>
      <button
        type="button"
        onClick={() => transfer.mutate()}
        disabled={transfer.isPending}
        className="rounded bg-ink px-2 py-0.5 font-semibold text-white hover:bg-ink/85 disabled:opacity-50"
      >
        {transfer.isPending ? '…' : 'Approve'}
      </button>
      {transfer.isError && <span className="text-stock-out">{transfer.error.message}</span>}
    </span>
  )
}
