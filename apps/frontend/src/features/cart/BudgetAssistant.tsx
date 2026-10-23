import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Check, Sparkles, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { buttonStyles, Spinner } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { useAuth } from '@/features/auth/authStore'
import { inputClass } from '@/features/auth/AuthPages'
import { useCart } from '@/features/cart/useCart'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatPrice } from '@/lib/format'
import type { ProductSummary } from '@/lib/types'

interface Swap {
  replaceProductId: string
  replaceName: string
  quantity: number
  with: ProductSummary
  saving: number
  newTotal: number
  reason: string
}

interface Assist {
  empty: boolean
  budgetUsd: number
  total: number
  shippingFee: number
  shippingExplanation: string
  withinBudget: boolean
  overBudgetBy: number
  plan: Swap[]
  suggestions: Swap[]
  planTotal: number
  planWithinBudget: boolean
  summary: string
  aiAssisted: boolean
}

/**
 * Budget check on the server-priced cart. The assistant only proposes swaps; each one is applied
 * by the shopper with its own button, through the normal cart endpoints.
 */
export function BudgetAssistant() {
  const user = useAuth((s) => s.user)
  const { setQuantity, isUpdating } = useCart()
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState<'USD' | 'INR'>('INR')
  const [applied, setApplied] = useState<string[]>([])
  const assist = useMutation({
    mutationFn: () =>
      api<Assist>('/api/ai/checkout/assist', { method: 'POST', body: JSON.stringify({ budget: Number(budget), currency, region: user?.region ?? 'IN-WEST' }) }),
    onSuccess: () => setApplied([]),
  })

  if (!user) return null

  async function apply(s: Swap) {
    await setQuantity(s.replaceProductId, 0)
    await setQuantity(s.with.id, s.quantity)
    setApplied((a) => [...a, s.replaceProductId])
  }

  const r = assist.data
  const swaps = r ? (r.plan.length ? r.plan : r.withinBudget ? [] : r.suggestions.slice(0, 3)) : []

  return (
    <section className="mt-4 rounded-card border border-ai/25 bg-surface p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Wallet className="size-4 text-ai" aria-hidden /> Check against my budget
      </h2>
      <form
        className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (Number(budget) > 0) assist.mutate()
        }}
      >
        <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'INR')} aria-label="Currency" className={cn(inputClass, 'px-2')}>
          <option value="INR">₹</option>
          <option value="USD">$</option>
        </select>
        <input type="number" min={1} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={currency === 'INR' ? '1,50,000' : '1,800'} aria-label="Budget" className={cn(inputClass, 'min-w-0')} />
        <button type="submit" disabled={assist.isPending || !(Number(budget) > 0)} className={cn(buttonStyles.secondary, 'col-span-2 py-2')}>
          {assist.isPending ? <Spinner /> : <Sparkles className="size-4 text-ai" aria-hidden />}
          Check my cart
        </button>
      </form>
      {assist.isError && <p className="mt-2 text-xs text-stock-out">{assist.error.message}</p>}

      {r && !r.empty && (
        <div className="mt-3 space-y-3 text-sm">
          <p className={cn('rounded-md px-3 py-2', r.withinBudget ? 'bg-[#e6f4ea] text-stock-in' : 'bg-accent-soft')}>
            {r.summary}
          </p>
          {currency === 'INR' && <p className="text-xs text-ink-subtle">Your budget ≈ {formatPrice(r.budgetUsd)} (prices are in US dollars).</p>}
          {swaps.length > 0 && (
            <ul className="space-y-2">
              {swaps.map((s) => {
                const done = applied.includes(s.replaceProductId)
                return (
                  <li key={`${s.replaceProductId}-${s.with.id}`} className="rounded-md border border-line p-2.5">
                    <p className="flex items-center gap-1 text-xs text-ink-muted">
                      <span className="line-clamp-1">{s.replaceName}</span> <ArrowRight className="size-3 shrink-0" aria-hidden />
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <ProductImage src={s.with.image} name={s.with.name} brand={s.with.brand} specs={s.with.specs} className="size-12 shrink-0 rounded border border-line" />
                      <div className="min-w-0 flex-1">
                        <Link to={`/p/${s.with.slug}`} className="line-clamp-1 font-medium hover:text-accent">{s.with.name}</Link>
                        <p className="text-xs text-ink-muted">{formatPrice(s.with.price)} · saves <strong className="text-stock-in">{formatPrice(s.saving)}</strong></p>
                        <p className="text-[11px] text-ink-subtle">{s.reason}</p>
                      </div>
                    </div>
                    <button type="button" disabled={done || isUpdating} onClick={() => apply(s)} className={cn(buttonStyles.secondary, 'mt-2 w-full py-1.5 text-xs')}>
                      {done ? <><Check className="size-3.5" aria-hidden /> Swapped</> : 'Swap in my cart'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {applied.length > 0 && (
            <button type="button" onClick={() => assist.mutate()} className="text-xs font-medium text-accent hover:underline">
              Re-check my cart
            </button>
          )}
        </div>
      )}
    </section>
  )
}
