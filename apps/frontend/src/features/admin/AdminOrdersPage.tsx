import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FastForward } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ErrorState } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { formatDay, type OrderStatus, statusLabel, statusTone } from '@/features/orders/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

interface AdminOrder {
  id: string
  status: OrderStatus
  total: number
  createdAt: string
  promisedDate: string
  eta: string | null
  customer: string
  tier: string
  warehouseId: string
  carrier: string | null
  delayed: boolean
  items: number
}

interface Issue {
  orderId: string
  status: OrderStatus
  customer: string
  tier: string
  lastEvent: string
  issue: string
  suggestedAction: string
}

const filters: (OrderStatus | 'ALL')[] = ['ALL', 'PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED']

export function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | 'ALL'>('ALL')
  const qc = useQueryClient()
  const orders = useQuery({
    queryKey: ['admin-orders', status],
    queryFn: () => api<AdminOrder[]>(`/api/admin/orders${status === 'ALL' ? '' : `?status=${status}`}`),
    refetchInterval: 15_000,
  })
  const issues = useQuery({ queryKey: ['ops-issues'], queryFn: () => api<Issue[]>('/api/ops/issues'), refetchInterval: 15_000 })
  const advance = useMutation({
    mutationFn: (id: string) => api(`/api/admin/orders/${id}/advance`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] })
      qc.invalidateQueries({ queryKey: ['ops-issues'] })
      qc.invalidateQueries({ queryKey: ['ops-kpis'] })
    },
  })

  return (
    <div>
      <AdminPageHeader title="Orders" description="Shipments move automatically; use Advance to step an order forward for a demo." />

      {issues.data && issues.data.length > 0 && (
        <section className="mb-5 rounded-card border border-stock-low/40 bg-[#fffaf0] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-stock-low">
            <AlertTriangle className="size-4" aria-hidden /> {issues.data.length} fulfilment issue{issues.data.length > 1 && 's'}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {issues.data.map((i) => (
              <li key={i.orderId}>
                <span className="font-medium">{i.orderId}</span> · {i.customer} ({i.tier.toLowerCase()}) · {i.issue.replace(/_/g, ' ').toLowerCase()} — {i.lastEvent}
                <span className="block text-xs text-ink-muted">{i.suggestedAction}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex gap-1 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatus(f)}
            className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium', status === f ? 'bg-ink text-white' : 'border border-line bg-surface text-ink-muted hover:text-ink')}
          >
            {f === 'ALL' ? 'All' : statusLabel[f]}
          </button>
        ))}
      </div>

      {orders.isError && <ErrorState title="Couldn’t load orders" detail={orders.error.message} />}
      {orders.data && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line bg-canvas/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Centre</th>
                <th className="px-3 py-2.5">ETA</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.data.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2.5">
                    <Link to={`/orders/${o.id}`} className="font-medium hover:text-accent">{o.id}</Link>
                    <span className="block text-xs text-ink-subtle">{o.items} item{o.items > 1 && 's'} · {formatDay(o.createdAt)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {o.customer}
                    <span className="block text-xs text-ink-subtle">{o.tier.toLowerCase()}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', statusTone[o.status])}>{statusLabel[o.status]}</span>
                    {o.delayed && <span className="ml-1 text-[11px] font-semibold text-stock-low">delayed</span>}
                  </td>
                  <td className="px-3 py-2.5">{o.warehouseId}</td>
                  <td className="px-3 py-2.5">{formatDay(o.eta ?? o.promisedDate)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(o.total)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(o.status) && (
                      <button
                        type="button"
                        onClick={() => advance.mutate(o.id)}
                        disabled={advance.isPending}
                        className="inline-flex items-center gap-1 rounded border border-line-strong px-2 py-0.5 text-xs font-semibold hover:bg-canvas disabled:opacity-50"
                      >
                        <FastForward className="size-3" aria-hidden /> Advance
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.data.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">No orders.</p>}
        </div>
      )}
    </div>
  )
}
