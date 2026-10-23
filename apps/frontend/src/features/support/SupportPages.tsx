import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Headset, LifeBuoy, Plus, Send } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { useAuth } from '@/features/auth/authStore'
import { inputClass } from '@/features/auth/AuthPages'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

export interface SupportCase {
  id: string
  subject: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  priority: 'LOW' | 'NORMAL' | 'HIGH'
  source: 'USER' | 'AI_FOLLOW_UP'
  orderId: string | null
  messages: { from: 'USER' | 'AGENT' | 'SYSTEM'; author: string; text: string; at: string }[]
  customer?: { name: string; email: string; tier: string }
  createdAt: string
  updatedAt: string
}

const statusStyle: Record<SupportCase['status'], string> = {
  OPEN: 'bg-accent-soft text-accent',
  IN_PROGRESS: 'bg-ai-soft text-ai',
  RESOLVED: 'bg-[#e6f4ea] text-stock-in',
  CLOSED: 'bg-canvas text-ink-muted',
}

export function StatusPill({ status }: { status: SupportCase['status'] }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', statusStyle[status])}>{status.replace('_', ' ')}</span>
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function SupportPage() {
  const cases = useQuery({ queryKey: ['support-cases'], queryFn: () => api<SupportCase[]>('/api/support/cases') })
  const [creating, setCreating] = useState(false)
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><LifeBuoy className="size-6" aria-hidden /> Help & support</h1>
          <p className="text-sm text-ink-muted">Most questions are answered instantly by the assistant. For anything else, our team replies within one business day.</p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className={buttonStyles.primary}>
            <Plus className="size-4" aria-hidden /> New request
          </button>
        )}
      </div>
      {creating && <NewCase onDone={() => setCreating(false)} />}
      <ul className="mt-6 divide-y divide-line rounded-card border border-line bg-surface">
        {cases.isPending && <li className="p-6 text-sm text-ink-muted">Loading…</li>}
        {cases.data?.length === 0 && <li className="p-8 text-center text-sm text-ink-muted">No support requests yet.</li>}
        {cases.data?.map((c) => (
          <li key={c.id}>
            <Link to={`/support/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
              {c.source === 'AI_FOLLOW_UP' ? <Bot className="size-4 text-ai" aria-hidden /> : <Headset className="size-4 text-ink-muted" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-medium">{c.subject}</span>
                <span className="text-xs text-ink-subtle">{c.orderId ? `${c.orderId} · ` : ''}updated {when(c.updatedAt)}</span>
              </span>
              <StatusPill status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NewCase({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [orderId, setOrderId] = useState('')
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api<{ id: string; firstItemName: string }[]>('/api/orders') })
  const create = useMutation({
    mutationFn: () => api<SupportCase>('/api/support/cases', { method: 'POST', body: JSON.stringify({ subject, message, orderId: orderId || null }) }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['support-cases'] })
      onDone()
      navigate(`/support/${c.id}`)
    },
  })
  return (
    <form
      className="mt-5 space-y-3 rounded-card border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <label className="block text-sm font-medium">
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={200} className={cn(inputClass, 'mt-1')} />
      </label>
      <label className="block text-sm font-medium">
        Order (optional)
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={cn(inputClass, 'mt-1')}>
          <option value="">Not about an order</option>
          {orders.data?.map((o) => <option key={o.id} value={o.id}>{o.id} — {o.firstItemName}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">
        How can we help?
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={3} maxLength={2000} rows={4} className={cn(inputClass, 'mt-1')} />
      </label>
      {create.isError && <p className="text-sm text-stock-out">{create.error.message}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={create.isPending} className={buttonStyles.primary}>{create.isPending ? <Spinner /> : 'Send request'}</button>
        <button type="button" onClick={onDone} className={buttonStyles.secondary}>Cancel</button>
      </div>
    </form>
  )
}

/** Conversation view, shared by shoppers (/support/:id) and staff (/admin/support/:id). */
export function CaseDetailPage({ staff = false }: { staff?: boolean }) {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const me = useAuth((s) => s.user)
  const c = useQuery({ queryKey: ['support-case', id], queryFn: () => api<SupportCase>(`/api/support/cases/${id}`), refetchInterval: 20_000 })
  const [text, setText] = useState('')
  const reply = useMutation({
    mutationFn: () => api<SupportCase>(`/api/support/cases/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: (d) => {
      qc.setQueryData(['support-case', id], d)
      qc.invalidateQueries({ queryKey: [staff ? 'admin-support' : 'support-cases'] })
      setText('')
    },
  })
  const setStatus = useMutation({
    mutationFn: (status: SupportCase['status']) => api<SupportCase>(`/api/admin/support/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (d) => {
      qc.setQueryData(['support-case', id], d)
      qc.invalidateQueries({ queryKey: ['admin-support'] })
    },
  })

  if (c.isPending) return <div className="px-4 py-10 text-sm text-ink-muted">Loading…</div>
  if (c.isError) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorState title="Case not found" detail={c.error.message} /></div>
  const d = c.data

  return (
    <div className={cn(!staff && 'mx-auto max-w-3xl px-4 py-6')}>
      <p className="text-xs text-ink-subtle">
        <Link to={staff ? '/admin/support' : '/support'} className="hover:text-ink">{staff ? 'Support cases' : 'Help & support'}</Link> / {d.id.slice(-6)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">{d.subject}</h1>
        <StatusPill status={d.status} />
        {d.priority === 'HIGH' && <span className="rounded bg-[#fdecec] px-1.5 py-0.5 text-[11px] font-bold text-stock-out">HIGH</span>}
      </div>
      <p className="text-sm text-ink-muted">
        {d.orderId && <Link to={staff ? '/admin/orders' : `/orders/${d.orderId}`} className="text-accent hover:underline">{d.orderId}</Link>}
        {d.orderId && ' · '}opened {when(d.createdAt)}{d.source === 'AI_FOLLOW_UP' && ' · follow-up from the AI assistant'}
      </p>
      {staff && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(['IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).filter((s) => s !== d.status).map((s) => (
            <button key={s} type="button" onClick={() => setStatus.mutate(s)} disabled={setStatus.isPending} className={cn(buttonStyles.secondary, 'px-3 py-1.5 text-xs')}>
              Mark {s.replace('_', ' ').toLowerCase()}
            </button>
          ))}
        </div>
      )}

      <ol className="mt-5 space-y-3">
        {d.messages.map((m, i) => {
          const mine = staff ? m.from === 'AGENT' : m.from === 'USER'
          return (
            <li key={i} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm', m.from === 'SYSTEM' ? 'border border-ai/25 bg-ai-soft/50' : mine ? 'bg-ink text-white' : 'border border-line bg-surface')}>
                <p className={cn('mb-0.5 text-[11px] font-semibold', mine && m.from !== 'SYSTEM' ? 'text-white/70' : 'text-ink-subtle')}>
                  {m.from === 'SYSTEM' ? 'AI assistant context' : m.from === 'AGENT' ? `${m.author} · ShopSmart support` : m.author} · {when(m.at)}
                </p>
                <p className="whitespace-pre-line">{m.text}</p>
              </div>
            </li>
          )
        })}
      </ol>

      {d.status !== 'CLOSED' ? (
        <form
          className="mt-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) reply.mutate()
          }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={staff ? `Reply to ${d.customer?.name ?? 'the customer'}…` : 'Add a message…'} className={cn(inputClass, 'flex-1')} />
          <button type="submit" disabled={reply.isPending || !text.trim()} className={buttonStyles.primary} aria-label="Send">
            {reply.isPending ? <Spinner /> : <Send className="size-4" aria-hidden />}
          </button>
        </form>
      ) : (
        <p className="mt-5 text-sm text-ink-muted">This case is closed.{!staff && ' Open a new request if you still need help.'}</p>
      )}
      {reply.isError && <p className="mt-2 text-sm text-stock-out">{reply.error.message}</p>}
      {me && staff && d.customer && <p className="mt-4 text-xs text-ink-subtle">Customer: {d.customer.name} · {d.customer.email} · {d.customer.tier.toLowerCase()}</p>}
    </div>
  )
}

export function AdminSupportPage() {
  const [status, setStatus] = useState<'ALL' | SupportCase['status']>('OPEN')
  const cases = useQuery({ queryKey: ['admin-support', status], queryFn: () => api<SupportCase[]>(`/api/admin/support/cases${status === 'ALL' ? '' : `?status=${status}`}`), refetchInterval: 30_000 })
  return (
    <div>
      <AdminPageHeader
        title="Support cases"
        description="High priority first. AI follow-ups carry the question and the assistant’s low-confidence answer."
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm">
            {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ALL'] as const).map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </select>
        }
      />
      {cases.isError && <ErrorState title="Couldn’t load cases" detail={cases.error.message} />}
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {cases.data?.length === 0 && <li className="p-8 text-center text-sm text-ink-muted">No cases here.</li>}
        {cases.data?.map((c) => (
          <li key={c.id}>
            <Link to={`/admin/support/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
              {c.source === 'AI_FOLLOW_UP' ? <Bot className="size-4 text-ai" aria-hidden /> : <Headset className="size-4 text-ink-muted" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-medium">{c.subject}</span>
                <span className="text-xs text-ink-subtle">{c.customer?.name} · {c.customer?.tier.toLowerCase()} · {c.messages.length} messages · updated {when(c.updatedAt)}</span>
              </span>
              {c.priority === 'HIGH' && <span className="rounded bg-[#fdecec] px-1.5 py-0.5 text-[11px] font-bold text-stock-out">HIGH</span>}
              <StatusPill status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
