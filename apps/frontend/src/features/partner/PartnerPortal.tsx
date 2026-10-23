import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, HandHeart, MapPin, Truck } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { useAuth } from '@/features/auth/authStore'
import { inputClass } from '@/features/auth/AuthPages'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

type OfferStatus = 'OFFERED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'PICKED_UP' | 'TRANSFERRED' | 'CANCELLED'

interface Offer {
  id: string
  status: OfferStatus
  productName: string
  image: string | null
  storage: string
  batchNo: string
  bestBefore: string
  quantity: number
  transferredQuantity: number | null
  pickupFrom: string
  distanceMeters: number
  offerExpiresAt: string
  createdAt: string
}

const tone: Record<OfferStatus, string> = {
  OFFERED: 'bg-accent-soft text-accent',
  ACCEPTED: 'bg-ai-soft text-ai',
  PICKED_UP: 'bg-ai-soft text-ai',
  TRANSFERRED: 'bg-[#e6f4ea] text-stock-in',
  REJECTED: 'bg-canvas text-ink-muted',
  EXPIRED: 'bg-canvas text-ink-muted',
  CANCELLED: 'bg-canvas text-ink-muted',
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Partner portal: accept or decline surplus offers, then confirm pickup and the quantity handed over. */
export function PartnerPortal() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  const offers = useQuery({ queryKey: ['partner-offers'], queryFn: () => api<Offer[]>('/api/partner/offers'), enabled: user?.role === 'PARTNER', refetchInterval: 30_000 })
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (user.role !== 'PARTNER') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">Partner accounts only</p>
        <p className="mt-1 text-sm text-ink-muted">Sign in with the account ShopSmart set up for your organisation.</p>
      </div>
    )
  }
  const open = offers.data?.filter((o) => ['OFFERED', 'ACCEPTED', 'PICKED_UP'].includes(o.status)) ?? []
  const past = offers.data?.filter((o) => !open.includes(o)) ?? []
  const donated = past.filter((o) => o.status === 'TRANSFERRED').reduce((n, o) => n + (o.transferredQuantity ?? 0), 0)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><HandHeart className="size-6 text-stock-in" aria-hidden /> {user.name}</h1>
      <p className="text-sm text-ink-muted">Food that would otherwise expire, offered to you first because you are within 3 km of our fulfilment centre.</p>
      {donated > 0 && <p className="mt-3 inline-block rounded-md bg-[#e6f4ea] px-3 py-1.5 text-sm font-medium text-stock-in">{donated} units rescued with ShopSmart so far</p>}

      {offers.isError && <div className="mt-6"><ErrorState title="Couldn’t load offers" detail={offers.error.message} /></div>}
      <h2 className="mt-6 font-semibold">Open offers</h2>
      {offers.isPending && <p className="mt-2 text-sm text-ink-muted">Loading…</p>}
      {offers.data && open.length === 0 && <p className="mt-2 rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-muted">No open offers right now — you’ll get an email and a notification when there is one.</p>}
      <ul className="mt-2 space-y-3">{open.map((o) => <OfferCard key={o.id} offer={o} />)}</ul>

      {past.length > 0 && (
        <>
          <h2 className="mt-8 font-semibold">History</h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface text-sm">
            {past.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{o.productName}</span>
                  <span className="block text-xs text-ink-subtle">{o.batchNo} · {fmt(o.createdAt)}</span>
                </span>
                <span className="tabular-nums text-ink-muted">{o.status === 'TRANSFERRED' ? `${o.transferredQuantity} units` : `${o.quantity} offered`}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', tone[o.status])}>{o.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function OfferCard({ offer: o }: { offer: Offer }) {
  const qc = useQueryClient()
  const [qty, setQty] = useState(String(o.quantity))
  const act = useMutation({
    mutationFn: (step: 'accept' | 'reject' | 'PICKED_UP' | 'TRANSFERRED') =>
      step === 'accept' || step === 'reject'
        ? api(`/api/partner/offers/${o.id}/${step}`, { method: 'POST' })
        : api(`/api/partner/offers/${o.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: step, ...(step === 'TRANSFERRED' && { transferredQuantity: Number(qty) }) }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['partner-offers'] }),
  })
  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex gap-4">
        {o.image && <img src={o.image} alt="" className="size-16 shrink-0 rounded-md border border-line object-contain" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{o.quantity} × {o.productName}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', tone[o.status])}>{o.status.replace('_', ' ')}</span>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{o.pickupFrom} · {(o.distanceMeters / 1000).toFixed(1)} km</span>
            <span>Best before {new Date(o.bestBefore).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {o.storage?.toLowerCase()}</span>
            <span>Batch {o.batchNo}</span>
          </p>
          {o.status === 'OFFERED' && <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-stock-low"><Clock className="size-3.5" aria-hidden /> Respond by {fmt(o.offerExpiresAt)}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {o.status === 'OFFERED' && (
          <>
            <button type="button" onClick={() => act.mutate('accept')} disabled={act.isPending} className={buttonStyles.primary}>{act.isPending ? <Spinner /> : <CheckCircle2 className="size-4" aria-hidden />} Accept</button>
            <button type="button" onClick={() => act.mutate('reject')} disabled={act.isPending} className={buttonStyles.secondary}>Decline</button>
          </>
        )}
        {o.status === 'ACCEPTED' && (
          <button type="button" onClick={() => act.mutate('PICKED_UP')} disabled={act.isPending} className={buttonStyles.dark}><Truck className="size-4" aria-hidden /> Mark picked up</button>
        )}
        {o.status === 'PICKED_UP' && (
          <>
            <label className="text-xs text-ink-muted">
              Units received
              <input type="number" min={1} max={o.quantity} value={qty} onChange={(e) => setQty(e.target.value)} className={cn(inputClass, 'mt-1 w-24')} />
            </label>
            <button type="button" onClick={() => act.mutate('TRANSFERRED')} disabled={act.isPending || !(Number(qty) >= 1)} className={buttonStyles.primary}>Confirm hand-over</button>
          </>
        )}
      </div>
      {act.isError && <p className="mt-2 text-sm text-stock-out">{act.error.message}</p>}
    </li>
  )
}
