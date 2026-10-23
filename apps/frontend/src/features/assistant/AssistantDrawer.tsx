import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  CircleCheck,
  Info,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { StockBadge } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { type Turn, useAssistant } from '@/features/assistant/assistantStore'
import { KnowledgeResult } from '@/features/assistant/KnowledgeResult'
import type { Decision, RecommendResponse, Recommendation } from '@/features/assistant/types'
import { useAuth } from '@/features/auth/authStore'
import { useCart } from '@/features/cart/useCart'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'

export const examplePrompts = [
  'Suggest a laptop under $1000 for Java development and AI projects',
  'Noise cancelling headphones for travel under $300',
  'Can I return an opened laptop?',
  'Does Prime membership include free delivery?',
  'What is the refund timeline?',
]

const useCaseLabel: Record<string, string> = {
  'software-development': 'Software development',
  'ai-ml': 'AI / ML',
  'content-creation': 'Content creation',
  'health-monitoring': 'Health monitoring',
}

/** Shopping assistant panel (Amazon Rufus–style): lives beside whatever page the shopper is on. */
export function AssistantDrawer() {
  const { open, turns, setOpen, ask, reset, product, setProduct } = useAssistant()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pending = turns.some((t) => t.pending)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  if (!open) return null

  function submit() {
    if (!text.trim() || pending) return
    void ask(text)
    setText('')
  }

  const lastResult = turns.at(-1)?.result
  const awaitingClarification = lastResult?.agent === 'SHOPPING' && lastResult.data.clarifyingQuestion

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="ShopSmart AI assistant">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-label="Close assistant" />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col bg-canvas shadow-2xl sm:w-[460px]">
        <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <span className="grid size-8 place-items-center rounded-full bg-ai text-white">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div className="flex-1 leading-tight">
            <p className="font-semibold">ShopSmart AI</p>
            <p className="text-xs text-ink-muted">Product picks and policy answers, with sources</p>
          </div>
          {turns.length > 0 && (
            <button type="button" onClick={reset} className="rounded-md p-2 text-ink-muted hover:bg-canvas hover:text-ink" title="New conversation">
              <RotateCcw className="size-4" aria-hidden />
              <span className="sr-only">New conversation</span>
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-ink-muted hover:bg-canvas hover:text-ink">
            <X className="size-5" aria-hidden />
            <span className="sr-only">Close</span>
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-4" aria-live="polite">
          {turns.length === 0 ? (
            <div className="pt-4">
              <p className="text-lg font-semibold">How can I help?</p>
              <p className="mt-1 text-sm text-ink-muted">
                Describe what you need and your budget, and I’ll pick in-stock products and show why. Ask about returns,
                refunds, delivery or warranty and I’ll answer from ShopSmart’s approved policies, with the source.
              </p>
              <ul className="mt-5 space-y-2">
                {examplePrompts.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => ask(p)}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm hover:border-ai hover:bg-ai-soft"
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            turns.map((t) => <TurnView key={t.id} turn={t} onAsk={ask} />)
          )}
        </div>

        <form
          className="border-t border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {product && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-muted">
              Asking about <span className="truncate font-semibold text-ink">{product.name}</span>
              <button type="button" onClick={() => setProduct(null)} className="ml-auto rounded p-0.5 hover:bg-canvas" aria-label="Stop asking about this product">
                <X className="size-3.5" />
              </button>
            </p>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2 focus-within:border-ai">
            <label htmlFor="assistant-input" className="sr-only">
              Message the shopping assistant
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              rows={1}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={awaitingClarification ? 'Answer the question above…' : 'e.g. a light laptop for college under $800'}
              className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm focus:outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim() || pending}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-ai text-white disabled:opacity-40"
              aria-label="Send"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-ink-subtle">Every answer is logged with its reasoning for review.</p>
        </form>
      </aside>
    </div>
  )
}

function TurnView({ turn, onAsk }: { turn: Turn; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-sm text-white">{turn.query}</p>

      {turn.steps.length > 0 && !turn.result && (
        <ol className="space-y-1.5 text-sm">
          {turn.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-ink-muted">
              {s.status === 'done' ? (
                <Check className="size-4 text-stock-in" aria-hidden />
              ) : (
                <Loader2 className="size-4 animate-spin text-ai" aria-hidden />
              )}
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {turn.pending && turn.steps.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin text-ai" aria-hidden /> Thinking…
        </p>
      )}
      {turn.error && (
        <p className="flex gap-2 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-stock-out">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {turn.error}
        </p>
      )}
      {turn.result?.agent === 'SHOPPING' && <ResultView result={turn.result.data} steps={turn.steps} onAsk={onAsk} />}
      {turn.result?.agent === 'KNOWLEDGE' && (
        <>
          <KnowledgeResult result={turn.result.data} />
          {turn.result.data.auditId && <DecisionFooter auditId={turn.result.data.auditId} />}
        </>
      )}
    </div>
  )
}

function ResultView({ result, steps, onAsk }: { result: RecommendResponse; steps: Turn['steps']; onAsk: (q: string) => void }) {
  const i = result.interpretation
  const chips = [
    i.budgetMax != null ? `Up to ${formatPrice(i.budgetMax)}` : null,
    i.budgetMin != null ? `From ${formatPrice(i.budgetMin)}` : null,
    ...i.useCases.map((u) => useCaseLabel[u] ?? u.charAt(0).toUpperCase() + u.slice(1).replace(/-/g, ' ')),
    i.minRamGb ? `${i.minRamGb}GB+ RAM` : null,
    i.minStorageGb ? `${i.minStorageGb}GB+ storage` : null,
    i.needsDedicatedGpu ? 'Dedicated GPU' : null,
    i.preferredOs,
    ...i.brands,
  ].filter(Boolean) as string[]

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">I understood</p>
        <p className="mt-0.5 text-sm font-medium">{result.interpretedRequirement}</p>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-ai-soft px-2 py-0.5 text-xs font-medium text-ai">
                {c}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-subtle">
          {i.source === 'LLM' ? 'Read by NVIDIA Nemotron' : 'Read by rule-based parser'}
          {steps.length > 0 && ` · ${steps.reduce((n, s) => n + (s.durationMs ?? 0), 0)} ms`}
        </p>
      </div>

      {result.clarifyingQuestion && (
        <div className="rounded-xl border border-ai/30 bg-ai-soft p-3 text-sm">
          <p className="flex gap-2 font-medium text-ai">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {result.clarifyingQuestion}
          </p>
          {result.interpretation.category && /\$(\d+(?:\.\d+)?)/.test(result.clarifyingQuestion) && (
            <BudgetReply question={result.clarifyingQuestion} onAsk={onAsk} />
          )}
          {!result.interpretation.category && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['A laptop', 'A phone', 'Headphones', 'A home appliance'].map((o) => (
                <button key={o} type="button" onClick={() => onAsk(o)} className="rounded-full border border-ai/40 bg-surface px-2.5 py-1 text-xs font-medium text-ai hover:bg-ai hover:text-white">
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {result.summary && result.recommendations.length > 0 && <p className="text-sm leading-relaxed">{result.summary}</p>}

      {result.notices.map((n) => (
        <p key={n} className="flex gap-2 text-xs text-ink-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          {n}
        </p>
      ))}

      <ol className="space-y-3">
        {result.recommendations.map((r, idx) => (
          <li key={r.productId}>
            <RecommendationCard rec={r} rank={idx + 1} />
          </li>
        ))}
      </ol>

      {result.auditId && <DecisionFooter auditId={result.auditId} />}
    </div>
  )
}

/** "The lowest-priced option is … at $429" → one-tap "Show options up to $500". */
function BudgetReply({ question, onAsk }: { question: string; onAsk: (q: string) => void }) {
  const price = Number(question.match(/\$(\d+(?:\.\d+)?)/)?.[1])
  if (!price) return null
  const budget = Math.ceil(price / 100) * 100 + (price % 100 === 0 ? 100 : 0)
  return (
    <button
      type="button"
      onClick={() => onAsk(`Show options up to $${budget}`)}
      className="mt-2 rounded-full border border-ai/40 bg-surface px-2.5 py-1 text-xs font-medium text-ai hover:bg-ai hover:text-white"
    >
      Show options up to ${budget}
    </button>
  )
}

function RecommendationCard({ rec, rank }: { rec: Recommendation; rank: number }) {
  const [why, setWhy] = useState(false)
  const cart = useCart()
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setOpen = useAssistant((s) => s.setOpen)

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex gap-3 p-3">
        <Link to={`/p/${rec.slug}`} onClick={() => setOpen(false)} className="shrink-0">
          <ProductImage
            src={rec.image}
            name={rec.productName}
            brand={rec.brand}
            specs={{ type: rec.reason.includes('RAM') ? 'Laptop' : '' }}
            size="thumb"
            className="size-20 rounded-lg border border-line"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              #{rank} · {rec.brand} · {rec.productId}
            </p>
            <span className="shrink-0 rounded-md bg-ai-soft px-1.5 py-0.5 text-[11px] font-bold text-ai" title="Match score from the spec breakdown">
              {rec.score}% match
            </span>
          </div>
          <Link to={`/p/${rec.slug}`} onClick={() => setOpen(false)} className="line-clamp-2 text-sm font-semibold hover:text-accent">
            {rec.productName}
          </Link>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{formatPrice(rec.price, rec.currency)}</span>
            {rec.mrp && rec.mrp > rec.price && <span className="text-xs text-ink-subtle line-through">{formatPrice(rec.mrp, rec.currency)}</span>}
            <StockBadge availability={rec.availability} />
          </div>
        </div>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {rec.reason.split(', ').map((part) => (
            <span key={part} className="rounded-md bg-canvas px-2 py-0.5 text-xs font-medium">
              {part}
            </span>
          ))}
        </div>
        {rec.explanation && (
          <p className="flex gap-1.5 text-sm text-ink-muted">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-ai" aria-hidden />
            {rec.explanation}
          </p>
        )}
        {rec.tradeoffs.map((t) => (
          <p key={t} className="flex gap-1.5 text-xs text-stock-low">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {t}
          </p>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={cart.isUpdating || rec.availability === 'OUT_OF_STOCK'}
            onClick={async () => {
              setError(null)
              try {
                await cart.setQuantity(rec.productId, cart.quantityOf(rec.productId) + 1)
                setAdded(true)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not add to cart')
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {added ? <Check className="size-3.5" aria-hidden /> : null}
            {added ? 'Added' : 'Add to cart'}
          </button>
          <button
            type="button"
            aria-expanded={why}
            onClick={() => setWhy((w) => !w)}
            className="inline-flex items-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold hover:bg-canvas"
          >
            Why this?
            <ChevronDown className={cn('size-3.5 transition', why && 'rotate-180')} aria-hidden />
          </button>
        </div>
        {error && <p className="text-xs text-stock-out">{error}</p>}

        {why && (
          <div className="mt-1 rounded-lg bg-canvas p-3">
            {rec.matchedRequirements.length > 0 && (
              <ul className="mb-3 space-y-1">
                {rec.matchedRequirements.map((m) => (
                  <li key={m} className="flex gap-1.5 text-xs">
                    <CircleCheck className="mt-px size-3.5 shrink-0 text-stock-in" aria-hidden />
                    {m}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Score breakdown</p>
            <ul className="mt-1.5 space-y-1.5">
              {rec.scoreBreakdown.map((c) => (
                <li key={c.name} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular-nums text-ink-muted">
                      {c.points}/{c.max}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-ai" style={{ width: `${c.max ? (c.points / c.max) * 100 : 0}%` }} />
                  </div>
                  <p className="mt-0.5 text-ink-subtle">{c.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  )
}

function DecisionFooter({ auditId }: { auditId: string }) {
  const token = useAuth((s) => s.token)
  const [showTrace, setShowTrace] = useState(false)
  const feedback = useMutation({
    mutationFn: (rating: 1 | -1) =>
      api<void>(`/api/ai/decisions/${auditId}/feedback`, { method: 'POST', body: JSON.stringify({ rating }) }),
  })
  const trace = useQuery({
    queryKey: ['decision', auditId],
    queryFn: () => api<Decision>(`/api/ai/decisions/${auditId}`),
    enabled: showTrace,
  })

  return (
    <div className="space-y-2 border-t border-line pt-2">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <button type="button" onClick={() => setShowTrace((s) => !s)} className="inline-flex items-center gap-1 hover:text-ink">
          <ShieldCheck className="size-3.5" aria-hidden />
          {showTrace ? 'Hide decision trace' : 'View decision trace'}
        </button>
        {token && (
          <span className="ml-auto flex items-center gap-1">
            {feedback.isSuccess ? (
              <span className="text-stock-in">Thanks for the feedback</span>
            ) : (
              <>
                Helpful?
                <button type="button" onClick={() => feedback.mutate(1)} className="rounded p-1 hover:bg-canvas hover:text-ink" aria-label="Helpful">
                  <ThumbsUp className="size-3.5" />
                </button>
                <button type="button" onClick={() => feedback.mutate(-1)} className="rounded p-1 hover:bg-canvas hover:text-ink" aria-label="Not helpful">
                  <ThumbsDown className="size-3.5" />
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {showTrace && (
        <div className="rounded-lg border border-line bg-surface p-3 text-xs">
          {trace.isPending && <p className="text-ink-muted">Loading trace…</p>}
          {trace.isError && <p className="text-stock-out">{trace.error.message}</p>}
          {trace.data && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-ink-subtle">Decision</dt>
                <dd className="font-mono text-[11px]">{trace.data.id}</dd>
                <dt className="text-ink-subtle">Model</dt>
                <dd>{trace.data.model ?? 'none (rule-based)'}</dd>
                <dt className="text-ink-subtle">Tokens</dt>
                <dd>
                  {trace.data.promptTokens != null ? `${trace.data.promptTokens} in · ${trace.data.completionTokens} out` : '—'}
                </dd>
                <dt className="text-ink-subtle">Latency</dt>
                <dd>{trace.data.latencyMs} ms</dd>
                <dt className="text-ink-subtle">Retrieved</dt>
                <dd>
                  {trace.data.retrievedIds.length} {trace.data.agent === 'KNOWLEDGE' ? 'policy sections' : 'products'} considered
                </dd>
              </dl>
              <ol className="mt-2 space-y-1 border-t border-line pt-2">
                {trace.data.toolCalls.map((c, idx) => (
                  <li key={idx} className="flex justify-between gap-2">
                    <span>{String(c.label)}</span>
                    <span className="tabular-nums text-ink-subtle">{String(c.durationMs)} ms</span>
                  </li>
                ))}
              </ol>
              {trace.data.error && <p className="mt-2 text-stock-low">Fallback used: {trace.data.error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
