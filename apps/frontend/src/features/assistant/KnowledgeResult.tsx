import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpenCheck, ChevronDown, FileText, Headset, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/features/auth/authStore'
import type { Citation, Confidence, KnowledgeAnswer, SourceSection } from '@/features/assistant/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

const confidenceStyle: Record<Confidence, { label: string; className: string; hint: string }> = {
  HIGH: { label: 'High confidence', className: 'bg-[#e6f4ea] text-stock-in', hint: 'The answer is stated directly in an approved policy.' },
  MEDIUM: { label: 'Medium confidence', className: 'bg-[#fdf3e2] text-stock-low', hint: 'The policy covers this, but check the cited section.' },
  LOW: { label: 'Not found in policies', className: 'bg-canvas text-ink-muted', hint: 'No approved document answers this clearly.' },
}

/** Policy answer with numbered citations (Perplexity-style) that open the exact source section. */
export function KnowledgeResult({ result }: { result: KnowledgeAnswer }) {
  const [openSource, setOpenSource] = useState<Citation | null>(null)
  const conf = confidenceStyle[result.confidence]

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            <BookOpenCheck className="size-3.5" aria-hidden /> From ShopSmart policies
          </p>
          <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-bold', conf.className)} title={conf.hint}>
            {conf.label}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed">
          {result.answer}
          {!result.followUpRequired &&
            result.citations.map((c) => (
              <button
                key={c.n}
                type="button"
                onClick={() => setOpenSource(c)}
                className="ml-1 inline-grid size-5 place-items-center rounded bg-ai-soft align-text-top text-[11px] font-bold text-ai hover:bg-ai hover:text-white"
                aria-label={`Source ${c.n}: ${c.document}, ${c.section}`}
              >
                {c.n}
              </button>
            ))}
        </p>

        {result.followUpRequired && <FollowUp auditId={result.auditId} />}
      </div>

      {result.sources.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Sources</p>
          <ol className="space-y-1.5">
            {result.citations.map((c) => (
              <li key={c.n}>
                <button
                  type="button"
                  onClick={() => setOpenSource(c)}
                  className="flex w-full items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs hover:border-ai"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded bg-ai-soft font-bold text-ai">{c.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {c.document} › {c.section}
                    </span>
                    <span className="text-ink-subtle">
                      Version {c.version} · effective {formatDate(c.effectiveDate)}
                    </span>
                  </span>
                  <FileText className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {result.notices.map((n) => (
        <p key={n} className="flex gap-2 text-xs text-ink-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          {n}
        </p>
      ))}

      {openSource && <SourcePanel citation={openSource} onClose={() => setOpenSource(null)} />}
    </div>
  )
}

function SourcePanel({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const source = useQuery({
    queryKey: ['source', citation.chunkId],
    queryFn: () => api<SourceSection>(`/api/ai/knowledge/chunks/${citation.chunkId}`),
  })
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="rounded-xl border border-ai/30 bg-surface shadow-sm" role="region" aria-label="Source document">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{citation.document}</p>
          <p className="text-xs text-ink-muted">
            {citation.section} · v{citation.version} · effective {formatDate(citation.effectiveDate)}
          </p>
        </div>
        <button type="button" onClick={() => setExpanded((e) => !e)} className="rounded p-1 hover:bg-canvas" aria-label="Toggle section">
          <ChevronDown className={cn('size-4 transition', !expanded && '-rotate-90')} />
        </button>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-canvas" aria-label="Close source">
          <X className="size-4" />
        </button>
      </div>
      {expanded && (
        <div className="max-h-64 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed text-ink-muted">
          {source.isPending && 'Loading section…'}
          {source.isError && <span className="text-stock-out">{source.error.message}</span>}
          {source.data && (
            <>
              {!source.data.active && (
                <p className="mb-2 rounded bg-[#fdf3e2] px-2 py-1 text-xs text-stock-low">This version has since been superseded.</p>
              )}
              {source.data.text.split('\n').map((line, i) => (
                <p key={i} className="mb-1.5">
                  {line}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Low-confidence answers offer a human follow-up; the case carries the AI decision so staff see what was asked. */
function FollowUp({ auditId }: { auditId: string | null }) {
  const user = useAuth((s) => s.user)
  const open = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/api/support/cases', {
        method: 'POST',
        // the server attaches the question and the assistant's answer from the AI decision
        body: JSON.stringify({ subject: 'Question the assistant could not answer', message: 'Please follow up on my question to the assistant.', aiDecisionId: auditId }),
      }),
  })
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-muted">
      <Headset className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">No approved policy answers this clearly, so nothing was guessed.</span>
      {!user ? (
        <Link to="/login?next=/support" className="font-semibold text-accent hover:underline">Sign in to ask a support agent</Link>
      ) : open.data ? (
        <Link to={`/support/${open.data.id}`} className="font-semibold text-stock-in hover:underline">Case opened — view it</Link>
      ) : (
        <button type="button" onClick={() => open.mutate()} disabled={open.isPending} className="font-semibold text-accent hover:underline disabled:opacity-50">
          {open.isPending ? 'Opening…' : 'Ask a support agent'}
        </button>
      )}
      {open.isError && <span className="w-full text-stock-out">{open.error.message}</span>}
    </div>
  )
}
