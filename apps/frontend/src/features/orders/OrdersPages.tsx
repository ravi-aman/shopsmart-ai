import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Circle, CircleCheck, Package, PartyPopper, RotateCcw, Sparkles, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { useAssistant } from '@/features/assistant/assistantStore'
import { inputClass } from '@/features/auth/AuthPages'
import {
  flow,
  formatDay,
  formatTime,
  type OrderDetail,
  type OrderItem,
  type OrderSummary,
  statusLabel,
  statusTone,
} from '@/features/orders/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

export function OrdersPage() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api<OrderSummary[]>('/api/orders') })

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Your orders</h1>
      {orders.isPending && <p className="mt-4 text-sm text-ink-muted">Loading…</p>}
      {orders.isError && <div className="mt-4"><ErrorState title="Couldn’t load orders" detail={orders.error.message} onRetry={() => orders.refetch()} /></div>}
      {orders.data?.length === 0 && (
        <div className="py-14 text-center">
          <Package className="mx-auto size-10 text-ink-subtle" strokeWidth={1.4} aria-hidden />
          <p className="mt-3 font-semibold">No orders yet</p>
          <Link to="/" className={`${buttonStyles.secondary} mt-5`}>
            Start shopping
          </Link>
        </div>
      )}
      <ul className="mt-5 space-y-3">
        {orders.data?.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 hover:border-line-strong">
              <ProductImage src={o.firstItemImage} name={o.firstItemName} brand="" specs={{}} size="thumb" className="size-16 shrink-0 rounded-md border border-line" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-subtle">
                  {o.id} · {formatDay(o.createdAt)}
                </p>
                <p className="truncate font-medium">
                  {o.firstItemName}
                  {o.itemCount > 1 && <span className="text-ink-muted"> + {o.itemCount - 1} more</span>}
                </p>
                <p className="text-sm text-ink-muted">{formatPrice(o.total, o.currency)}</p>
              </div>
              <span className={cn('shrink-0 rounded-md px-2 py-1 text-xs font-semibold', statusTone[o.status])}>{statusLabel[o.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function OrderDetailPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const ask = useAssistant((s) => s.ask)
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
    refetchInterval: (q) => (q.state.data && flow.slice(0, 4).includes(q.state.data.status) ? 15_000 : false),
  })
  const cancel = useMutation({
    mutationFn: () => api<OrderDetail>(`/api/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (o) => {
      qc.setQueryData(['order', id], o)
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
  const [confirmCancel, setConfirmCancel] = useState(false)

  if (order.isPending) return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-ink-muted">Loading order…</div>
  if (order.isError) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorState title="Order not found" detail={order.error.message} /></div>
  const o = order.data
  const eta = o.shipment?.eta ?? o.promisedDate

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {params.get('placed') && (
        <p className="mb-4 flex items-center gap-2 rounded-card bg-[#e6f4ea] px-4 py-3 text-sm font-medium text-stock-in">
          <PartyPopper className="size-4" aria-hidden /> Order placed. We’ll keep this page updated as it moves.
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-ink-subtle">
            <Link to="/orders" className="hover:text-ink">Orders</Link> / {o.id}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{statusLabel[o.status]}</h1>
          {!['CANCELLED', 'DELIVERED', 'RETURN_REQUESTED'].includes(o.status) && (
            <p className="text-sm text-ink-muted">
              Arriving <strong className="text-ink">{formatDay(eta)}</strong>
              {o.shipment?.delayed && <span className="ml-2 text-stock-low">· delayed at hub</span>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => ask(`Where is my order ${o.id}?`, null)} className={buttonStyles.secondary}>
            <Sparkles className="size-4 text-ai" aria-hidden /> Ask about this order
          </button>
          {o.cancel.allowed && !confirmCancel && (
            <button type="button" onClick={() => setConfirmCancel(true)} className={buttonStyles.secondary}>
              Cancel order
            </button>
          )}
        </div>
      </div>

      {confirmCancel && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-stock-out/30 bg-[#fdf2f2] p-4 text-sm">
          <XCircle className="size-5 text-stock-out" aria-hidden />
          <span className="flex-1">
            Cancel {o.id}? {o.cancel.reason} <span className="text-ink-subtle">({o.cancel.policy.document} › {o.cancel.policy.section})</span>
          </span>
          <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-md bg-stock-out px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            {cancel.isPending ? 'Cancelling…' : 'Yes, cancel'}
          </button>
          <button type="button" onClick={() => setConfirmCancel(false)} className="text-ink-muted hover:text-ink">
            Keep order
          </button>
          {cancel.isError && <p className="w-full text-stock-out">{cancel.error.message}</p>}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Timeline order={o} />
          <section className="rounded-card border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Items</h2>
            <ul className="divide-y divide-line">
              {o.items.map((i) => (
                <ItemRow key={i.productId} item={i} order={o} />
              ))}
            </ul>
          </section>
        </div>
        <aside className="h-fit space-y-4 rounded-card border border-line bg-surface p-5 text-sm">
          <div>
            <h2 className="font-semibold">Delivery</h2>
            <p className="mt-1 text-ink-muted">
              {o.address.name}
              <br />
              {o.address.line1}, {o.address.city} {o.address.pincode}
            </p>
          </div>
          {o.shipment && (
            <div>
              <h2 className="font-semibold">Shipment</h2>
              <p className="mt-1 text-ink-muted">
                {o.shipment.carrier} · {o.shipment.trackingNo}
                <br />
                From {o.warehouseCity}
              </p>
            </div>
          )}
          <dl className="space-y-1 border-t border-line pt-3">
            <div className="flex justify-between"><dt className="text-ink-muted">Items</dt><dd>{formatPrice(o.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">Delivery</dt><dd>{o.shippingFee === 0 ? 'FREE' : formatPrice(o.shippingFee)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatPrice(o.total)}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  )
}

/** Flipkart-style vertical timeline: the fixed flow, filled in with real carrier events. */
function Timeline({ order }: { order: OrderDetail }) {
  const events = order.shipment?.events ?? []
  if (order.status === 'CANCELLED' || order.status === 'RETURN_REQUESTED') {
    return <EventList events={events} />
  }
  const reached = flow.indexOf(order.status)
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <ol className="relative space-y-5">
        {flow.map((step, i) => {
          const done = i <= reached
          const evs = events.filter((e) => e.status === step || (step === 'SHIPPED' && e.status === 'DELAYED'))
          return (
            <li key={step} className="relative flex gap-3">
              {i < flow.length - 1 && (
                <span className={cn('absolute left-[9px] top-6 h-[calc(100%+4px)] w-0.5', i < reached ? 'bg-stock-in' : 'bg-line')} aria-hidden />
              )}
              {done ? <CheckCircle2 className="relative size-5 shrink-0 text-stock-in" /> : <Circle className="relative size-5 shrink-0 text-line-strong" />}
              <div className="-mt-0.5">
                <p className={cn('text-sm font-semibold', !done && 'text-ink-subtle')}>{statusLabel[step]}</p>
                {evs.map((e, k) => (
                  <p key={k} className={cn('text-xs', e.status === 'DELAYED' ? 'text-stock-low' : 'text-ink-muted')}>
                    {e.status === 'DELAYED' && <AlertTriangle className="mr-1 inline size-3" aria-hidden />}
                    {e.note} · {e.location} · {formatTime(e.at)}
                  </p>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function EventList({ events }: { events: NonNullable<OrderDetail['shipment']>['events'] }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <ol className="space-y-2 text-sm">
        {events.map((e, i) => (
          <li key={i} className="flex gap-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
            <span>
              <span className="font-medium">{e.note}</span>
              <span className="block text-xs text-ink-muted">{e.location} · {formatTime(e.at)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ItemRow({ item, order }: { item: OrderItem; order: OrderDetail }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const request = useMutation({
    mutationFn: () => api<OrderDetail>(`/api/orders/${order.id}/returns`, { method: 'POST', body: JSON.stringify({ productId: item.productId, reason }) }),
    onSuccess: (o) => {
      qc.setQueryData(['order', order.id], o)
      setOpen(false)
    },
  })
  const r = item.returnInfo

  return (
    <li className="p-4">
      <div className="flex gap-3">
        <Link to={`/p/${item.slug}`} className="shrink-0">
          <ProductImage src={item.image} name={item.name} brand={item.brand} specs={{}} size="thumb" className="size-16 rounded-md border border-line" />
        </Link>
        <div className="min-w-0 flex-1 text-sm">
          <Link to={`/p/${item.slug}`} className="font-medium hover:text-accent">{item.name}</Link>
          <p className="text-ink-muted">Qty {item.quantity} · {formatPrice(item.unitPrice)}</p>
          <p className={cn('mt-1 text-xs', r.eligible ? 'text-stock-in' : 'text-ink-subtle')}>
            {r.requestStatus && <RotateCcw className="mr-1 inline size-3" aria-hidden />}
            {r.reason} <span className="text-ink-subtle">· {r.policy.document} › {r.policy.section}{r.policy.version && ` v${r.policy.version}`}</span>
          </p>
        </div>
        {r.eligible && !open && (
          <button type="button" onClick={() => setOpen(true)} className={cn(buttonStyles.secondary, 'h-fit px-3 py-1.5 text-xs')}>
            Return item
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim().length >= 3) request.mutate()
          }}
        >
          <label htmlFor={`reason-${item.productId}`} className="sr-only">Reason for return</label>
          <input id={`reason-${item.productId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why are you returning it?" className={cn(inputClass, 'min-w-0 flex-1 py-1.5')} />
          <button type="submit" disabled={reason.trim().length < 3 || request.isPending} className={cn(buttonStyles.primary, 'py-1.5')}>
            {request.isPending && <Spinner />} Request pickup
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-muted">Cancel</button>
          {request.isError && <p className="w-full text-xs text-stock-out">{request.error.message}</p>}
        </form>
      )}
    </li>
  )
}
