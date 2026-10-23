import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Bot, Check, Loader2, Tag } from 'lucide-react'
import { useState } from 'react'
import { buttonStyles, ErrorState } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

interface Kpis {
  ordersToday: number
  revenueToday: number
  openOrders: number
  returnsPending: number
  delayedShipments: number
  aiAnswers24h: number
  lowConfidence24h: number
  aiFallbacks24h: number
  aiAvgLatencyMs: number
  helpfulVotes: number
  totalVotes: number
  ordersByDay: { day: string; orders: number; revenue: number }[]
  aiByAgent: { agent: string; count: number }[]
}

export interface OpsAction {
  type: 'TRANSFER' | 'PROMOTION'
  productId: string
  productName: string
  fromWarehouse: string | null
  toWarehouse: string | null
  quantity: number | null
  discountPercent: number | null
  rationale: string
}

interface OpsAnswer {
  answer: string
  actions: OpsAction[]
  toolCalls: { tool: string; result: string }[]
  aiAssisted: boolean
  auditId: string | null
}

const prompts = ['Which products will stock out this week?', 'Any delayed shipments?', 'What should we put on promotion?', 'Give me today’s summary']

export function OverviewPage() {
  const kpis = useQuery({ queryKey: ['ops-kpis'], queryFn: () => api<Kpis>('/api/ops/kpis'), refetchInterval: 30_000 })

  return (
    <div>
      <AdminPageHeader title="Operations overview" description="Live numbers from orders, shipments and the AI audit log." />
      {kpis.isError && <ErrorState title="Couldn’t load KPIs" detail={kpis.error.message} onRetry={() => kpis.refetch()} />}
      {kpis.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Orders today" value={String(kpis.data.ordersToday)} sub={`${formatPrice(kpis.data.revenueToday)} revenue`} />
            <Tile label="Open orders" value={String(kpis.data.openOrders)} sub={`${kpis.data.returnsPending} returns pending`} />
            <Tile
              label="Delayed shipments"
              value={String(kpis.data.delayedShipments)}
              tone={kpis.data.delayedShipments > 0 ? 'warn' : undefined}
              sub="in transit past schedule"
            />
            <Tile
              label="AI answers (24h)"
              value={String(kpis.data.aiAnswers24h)}
              sub={`${kpis.data.lowConfidence24h} not found · ${kpis.data.aiAvgLatencyMs} ms avg`}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <OrdersChart data={kpis.data.ordersByDay} />
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="text-sm font-semibold">AI usage by agent (7 days)</p>
              <ul className="mt-3 space-y-2">
                {kpis.data.aiByAgent.map((a) => {
                  const max = Math.max(...kpis.data.aiByAgent.map((x) => x.count), 1)
                  return (
                    <li key={a.agent} className="text-xs">
                      <div className="flex justify-between">
                        <span className="font-medium">{a.agent.toLowerCase()}</span>
                        <span className="tabular-nums text-ink-muted">{a.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-ai" style={{ width: `${(a.count / max) * 100}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-muted">
                Feedback: {kpis.data.helpfulVotes}/{kpis.data.totalVotes} helpful · {kpis.data.aiFallbacks24h} answers used a fallback in 24h
              </p>
            </div>
          </div>
        </>
      )}
      <OpsAgentPanel />
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={cn('rounded-card border bg-surface p-4', tone === 'warn' ? 'border-stock-low/40' : 'border-line')}>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums tracking-tight', tone === 'warn' && 'text-stock-low')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p>}
    </div>
  )
}

function OrdersChart({ data }: { data: Kpis['ordersByDay'] }) {
  const max = Math.max(...data.map((d) => d.orders), 1)
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm font-semibold">Orders, last 14 days</p>
      <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Bar chart of orders per day">
        {data.map((d) => (
          <div key={d.day} className="group flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-ink-subtle opacity-0 group-hover:opacity-100">{d.orders}</span>
            <div
              className="w-full rounded-t bg-ink/80 group-hover:bg-accent"
              style={{ height: `${Math.max(2, (d.orders / max) * 100)}%` }}
              title={`${d.day}: ${d.orders} orders, ${formatPrice(d.revenue)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
        <span>{data[0]?.day.slice(5)}</span>
        <span>{data.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  )
}

function OpsAgentPanel() {
  const [question, setQuestion] = useState('')
  const ask = useMutation({
    mutationFn: (q: string) => api<OpsAnswer>('/api/ops/agent', { method: 'POST', body: JSON.stringify({ question: q }) }),
  })

  return (
    <section className="mt-6 rounded-card border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Bot className="size-5 text-ai" aria-hidden />
        <p className="font-semibold">Ops agent</p>
        <p className="text-xs text-ink-muted">Reads forecasts, shipments and stock; proposes actions you approve.</p>
      </div>
      <div className="p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (question.trim()) ask.mutate(question.trim())
          }}
        >
          <label htmlFor="ops-q" className="sr-only">Ask the ops agent</label>
          <input
            id="ops-q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="e.g. Which products will stock out this week?"
            className="min-w-0 flex-1 rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          <button type="submit" disabled={ask.isPending || !question.trim()} className={buttonStyles.dark}>
            {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Ask'}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setQuestion(p)
                ask.mutate(p)
              }}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-ink hover:text-ink"
            >
              {p}
            </button>
          ))}
        </div>

        {ask.isError && <p className="mt-3 text-sm text-stock-out">{ask.error.message}</p>}
        {ask.data && (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed">{ask.data.answer}</p>
            <p className="text-[11px] text-ink-subtle">
              {ask.data.aiAssisted ? 'NVIDIA model chose tools: ' : 'Tools used: '}
              {ask.data.toolCalls.map((c) => c.tool).join(', ')}
            </p>
            {ask.data.actions.length > 0 && (
              <ul className="grid gap-2 md:grid-cols-2">
                {ask.data.actions.map((a) => (
                  <li key={a.type + a.productId + (a.toWarehouse ?? '')}>
                    <ActionCard action={a} auditId={ask.data.auditId} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export function ActionCard({ action, auditId }: { action: OpsAction; auditId: string | null }) {
  const qc = useQueryClient()
  const approve = useMutation({
    mutationFn: () =>
      action.type === 'TRANSFER'
        ? api('/api/ops/transfers', {
            method: 'POST',
            body: JSON.stringify({
              productId: action.productId,
              fromWarehouse: action.fromWarehouse,
              toWarehouse: action.toWarehouse,
              quantity: action.quantity,
              auditId,
            }),
          })
        : api('/api/ops/promotions', {
            method: 'POST',
            body: JSON.stringify({ productId: action.productId, discountPercent: action.discountPercent, days: 14, rationale: action.rationale, fromAgent: true, auditId }),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-forecast'] })
      qc.invalidateQueries({ queryKey: ['ops-promotions'] })
    },
  })

  return (
    <div className="h-full rounded-lg border border-line p-3 text-sm">
      <p className="flex items-center gap-1.5 font-semibold">
        {action.type === 'TRANSFER' ? <ArrowRightLeft className="size-4 text-ai" aria-hidden /> : <Tag className="size-4 text-accent" aria-hidden />}
        {action.type === 'TRANSFER'
          ? `Move ${action.quantity} × ${action.productName}`
          : `${action.discountPercent}% off ${action.productName}`}
      </p>
      {action.type === 'TRANSFER' && (
        <p className="text-xs text-ink-muted">
          {action.fromWarehouse} → {action.toWarehouse}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-muted">{action.rationale}</p>
      {approve.isSuccess ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-stock-in">
          <Check className="size-3.5" aria-hidden /> {action.type === 'TRANSFER' ? 'Transfer done' : 'Saved as draft — activate it under Inventory'}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          className="mt-2 rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white hover:bg-ink/85 disabled:opacity-50"
        >
          {approve.isPending ? 'Working…' : action.type === 'TRANSFER' ? 'Approve transfer' : 'Create draft'}
        </button>
      )}
      {approve.isError && <p className="mt-1 text-xs text-stock-out">{approve.error.message}</p>}
    </div>
  )
}
