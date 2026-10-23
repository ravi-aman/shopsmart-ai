import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, LogIn, Package, ShieldCheck, Wrench, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { KnowledgeResult } from '@/features/assistant/KnowledgeResult'
import { useAssistant } from '@/features/assistant/assistantStore'
import type { KnowledgeAnswer } from '@/features/assistant/types'
import { formatDay, type OrderStatus, statusLabel, statusTone, type TrackingEvent } from '@/features/orders/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

export interface ProposedAction {
  type: 'CANCEL' | 'RETURN'
  orderId: string
  productId: string | null
  productName: string | null
  allowed: boolean
  reason: string
  policyDocument: string
  policySection: string
  policyVersion: string | null
}

export interface OrderAgentResponse {
  answer: string
  intent: 'TRACK' | 'CANCEL' | 'RETURN'
  orderId: string | null
  status: OrderStatus | null
  eta: string | null
  delayed: boolean
  recentEvents: TrackingEvent[]
  actions: ProposedAction[]
  policy: KnowledgeAnswer | null
  toolCalls: { tool: string; args: Record<string, unknown>; result: string }[]
  aiAssisted: boolean
  signInRequired: boolean
  auditId: string | null
}

/** Order agent answer: facts from tools, the policy it relied on, and a confirm card for any proposed change. */
export function OrderResult({ result }: { result: OrderAgentResponse }) {
  const setOpen = useAssistant((s) => s.setOpen)

  if (result.signInRequired) {
    return (
      <div className="rounded-xl border border-line bg-surface p-3.5 text-sm">
        <p>{result.answer}</p>
        <Link to="/login" onClick={() => setOpen(false)} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
          <LogIn className="size-4" aria-hidden /> Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-3.5">
        {result.orderId && result.status && (
          <div className="mb-2 flex items-center gap-2">
            <Package className="size-4 text-ink-subtle" aria-hidden />
            <Link to={`/orders/${result.orderId}`} onClick={() => setOpen(false)} className="text-sm font-semibold hover:text-accent">
              {result.orderId}
            </Link>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-bold', statusTone[result.status])}>{statusLabel[result.status]}</span>
            {result.eta && !['DELIVERED', 'CANCELLED'].includes(result.status) && (
              <span className="ml-auto text-xs text-ink-muted">ETA {formatDay(result.eta)}</span>
            )}
          </div>
        )}
        <p className="text-sm leading-relaxed">{result.answer}</p>
        {result.delayed && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-stock-low">
            <AlertTriangle className="size-3.5" aria-hidden /> Shipment delayed at a sorting hub
          </p>
        )}
        {result.intent === 'TRACK' && result.recentEvents.length > 0 && (
          <ol className="mt-3 space-y-1 border-t border-line pt-2">
            {[...result.recentEvents].reverse().map((e, i) => (
              <li key={i} className={cn('text-xs', i === 0 ? 'text-ink' : 'text-ink-muted')}>
                <span className="font-medium">{e.note}</span> · {e.location}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-subtle">
          <Wrench className="size-3" aria-hidden />
          {result.aiAssisted ? 'NVIDIA model chose tools: ' : 'Tools used: '}
          {[...new Set(result.toolCalls.map((c) => c.tool))].join(', ')}
        </p>
      </div>

      {result.actions.map((a) => (
        <ActionCard key={a.type + a.orderId} action={a} />
      ))}

      {result.policy && result.policy.confidence !== 'LOW' && <KnowledgeResult result={result.policy} />}
    </div>
  )
}

/** The agent never acts on its own: the shopper confirms, and the normal order API performs the change. */
function ActionCard({ action }: { action: ProposedAction }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const confirm = useMutation({
    mutationFn: () =>
      action.type === 'CANCEL'
        ? api(`/api/orders/${action.orderId}/cancel`, { method: 'POST' })
        : api(`/api/orders/${action.orderId}/returns`, {
            method: 'POST',
            body: JSON.stringify({ productId: action.productId, reason: reason.trim() || 'Requested via assistant' }),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', action.orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
  const title = action.type === 'CANCEL' ? `Cancel ${action.orderId}` : `Return ${action.productName ?? 'item'}`

  return (
    <div className={cn('rounded-xl border p-3.5 text-sm', action.allowed ? 'border-accent/40 bg-accent-soft/50' : 'border-line bg-surface')}>
      <p className="flex items-center gap-2 font-semibold">
        {action.allowed ? <ShieldCheck className="size-4 text-accent" aria-hidden /> : <XCircle className="size-4 text-ink-subtle" aria-hidden />}
        {title}
        <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', action.allowed ? 'bg-accent text-white' : 'bg-canvas text-ink-muted')}>
          {action.allowed ? 'Allowed' : 'Not allowed'}
        </span>
      </p>
      <p className="mt-1 text-ink-muted">{action.reason}</p>
      <p className="mt-1 text-[11px] text-ink-subtle">
        Rule: {action.policyDocument} › {action.policySection}
        {action.policyVersion && ` v${action.policyVersion}`}
      </p>
      {action.allowed && !confirm.isSuccess && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {action.type === 'RETURN' && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Reason (optional)"
              aria-label="Return reason"
              className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs"
            />
          )}
          <button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {confirm.isPending ? 'Working…' : action.type === 'CANCEL' ? 'Confirm cancellation' : 'Confirm return pickup'}
          </button>
        </div>
      )}
      {confirm.isSuccess && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-stock-in">
          <Check className="size-3.5" aria-hidden /> {action.type === 'CANCEL' ? 'Order cancelled — refund initiated.' : 'Return requested — pickup will be scheduled.'}
        </p>
      )}
      {confirm.isError && <p className="mt-2 text-xs text-stock-out">{confirm.error.message}</p>}
    </div>
  )
}
