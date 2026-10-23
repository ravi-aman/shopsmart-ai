import { useQuery } from '@tanstack/react-query'
import { ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

interface AuditRow {
  id: string
  agent: string
  intent: string
  input: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null
  model: string | null
  latencyMs: number
  fallback: string | null
  user: string | null
  tokens: number | null
  rating: number | null
  createdAt: string
}

const agents = ['ALL', 'SHOPPING', 'KNOWLEDGE', 'ORDER', 'OPS']

/** Every AI decision with its inputs, tool steps, sources and output — the "auditable" requirement. */
export function AuditPage() {
  const [agent, setAgent] = useState('ALL')
  const [fallbacksOnly, setFallbacksOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const rows = useQuery({
    queryKey: ['audit', agent, fallbacksOnly],
    queryFn: () =>
      api<AuditRow[]>(`/api/ops/audit?limit=200${agent === 'ALL' ? '' : `&agent=${agent}`}${fallbacksOnly ? '&fallbacksOnly=true' : ''}`),
  })

  return (
    <div>
      <AdminPageHeader title="AI audit log" description="Each assistant answer, ops analysis and approval, with the evidence behind it." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {agents.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAgent(a)}
            className={cn('rounded-full px-3 py-1 text-xs font-medium', agent === a ? 'bg-ink text-white' : 'border border-line bg-surface text-ink-muted hover:text-ink')}
          >
            {a === 'ALL' ? 'All agents' : a.toLowerCase()}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={fallbacksOnly} onChange={(e) => setFallbacksOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
          Only answers that used a fallback
        </label>
      </div>

      {rows.isError && <ErrorState title="Couldn’t load the audit log" detail={rows.error.message} />}
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        {rows.data && (
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-3 py-2.5">Agent</th>
                  <th className="px-3 py-2.5">Input</th>
                  <th className="px-3 py-2.5">Confidence</th>
                  <th className="px-3 py-2.5 text-right">Latency</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.data.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r.id)} className={cn('cursor-pointer hover:bg-canvas/60', selected === r.id && 'bg-ai-soft/50')}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-muted">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs font-semibold">{r.agent.toLowerCase()}</td>
                    <td className="max-w-[340px] truncate px-3 py-2" title={r.input}>
                      {r.input}
                      <span className="block truncate text-[11px] text-ink-subtle">{r.user ?? 'guest'}{r.fallback && ' · fallback'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.confidence ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{r.latencyMs} ms</td>
                    <td className="px-3 py-2">
                      {r.rating === 1 && <ThumbsUp className="size-3.5 text-stock-in" aria-label="rated helpful" />}
                      {r.rating === -1 && <ThumbsDown className="size-3.5 text-stock-out" aria-label="rated not helpful" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected && <DecisionDetail id={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}

function DecisionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useQuery({ queryKey: ['decision-full', id], queryFn: () => api<Record<string, unknown>>(`/api/ai/decisions/${id}`) })
  return (
    <aside className="h-fit rounded-card border border-line bg-surface xl:sticky xl:top-32">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="flex-1 truncate font-mono text-xs">{id}</p>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-canvas" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4 text-xs">
        {d.isPending && <p className="text-ink-muted">Loading…</p>}
        {d.data &&
          (['input', 'model', 'latencyMs', 'promptTokens', 'completionTokens', 'error', 'extractedParams', 'toolCalls', 'retrievedIds', 'output'] as const).map(
            (k) =>
              d.data[k] != null && (
                <div key={k}>
                  <p className="font-semibold uppercase tracking-wide text-ink-subtle">{k}</p>
                  {typeof d.data[k] === 'object' ? (
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-canvas p-2 text-[11px] leading-snug">{JSON.stringify(d.data[k], null, 2)}</pre>
                  ) : (
                    <p className="mt-0.5 break-words">{String(d.data[k])}</p>
                  )}
                </div>
              ),
          )}
      </div>
    </aside>
  )
}
