import { config, nvidiaConfigured } from '../config.js'
import type { CurrentUser } from '../http/auth.js'
import { numbersGrounded } from '../knowledge/answer.js'
import { logger } from '../logger.js'
import { Product } from '../models/index.js'
import { availabilityStages, type ProductSummary, toSummary } from '../modules/catalog/repository.js'
import { type Line, priceLines, type Quote } from '../orders/pricing.js'
import { cartLines, policyVersion } from '../orders/service.js'
import { recordAudit } from './audit.js'
import { chatText, models } from './nvidia.js'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface Swap {
  replaceProductId: string
  replaceName: string
  quantity: number
  with: ProductSummary
  saving: number
  newTotal: number
  reason: string
}

/** In-stock products in the same category that are cheaper than the cart line, best rated first. */
async function cheaperAlternatives(productId: string, unitPrice: number, quantity: number, exclude: string[]) {
  const p = await Product.findById(productId).select('category brand specs').lean()
  if (!p) return []
  const rows = await Product.aggregate([
    { $match: { status: 'ACTIVE', category: p.category, _id: { $nin: exclude }, price: { $lt: unitPrice * 0.97 } } },
    ...availabilityStages,
    { $match: { available: { $gte: quantity } } },
    // same brand or more matching specs first, then rating, then the closest price (least downgrade)
    { $set: { _brand: { $cond: [{ $eq: ['$brand', p.brand] }, 1, 0] }, _gap: { $subtract: [unitPrice, '$price'] } } },
    { $sort: { rating: -1, _brand: -1, _gap: 1 } },
    { $limit: 4 },
  ])
  return rows.map(toSummary)
}

const swapLines = (lines: Line[], from: string, to: string) => lines.map((l) => (l.productId === from ? { ...l, productId: to } : l))

function summaryText(budget: number, q: Quote, plan: Swap[], finalTotal: number) {
  const over = round2(q.total - budget)
  if (over <= 0) return `Your cart total is $${q.total.toFixed(2)}, within your $${budget.toFixed(2)} budget ($${round2(budget - q.total).toFixed(2)} to spare). ${q.shippingExplanation}.`
  if (plan.length === 0) return `Your cart total is $${q.total.toFixed(2)}, $${over.toFixed(2)} over your $${budget.toFixed(2)} budget. I couldn't find cheaper in-stock alternatives in the same categories — removing an item or lowering a quantity would help.`
  const swaps = plan.map((s) => `${s.replaceName} → ${s.with.name} (saves $${s.saving.toFixed(2)})`).join('; ')
  return `Your cart total is $${q.total.toFixed(2)}, $${over.toFixed(2)} over your $${budget.toFixed(2)} budget. Suggested: ${swaps}. That brings the total to $${finalTotal.toFixed(2)}${finalTotal <= budget ? ', within budget' : ''}. Nothing changes until you approve.`
}

/**
 * AI checkout assistant: compares the server-priced cart to the shopper's budget and proposes
 * cheaper in-stock swaps with exact re-quoted totals (fees, clearance and promotions included).
 * It never edits the cart — the shopper applies a swap through the normal cart endpoints.
 */
export async function assistCheckout(user: CurrentUser, input: { budget: number; currency: 'USD' | 'INR'; region: string }, conversationId: string | null) {
  const started = Date.now()
  const budget = round2(input.currency === 'INR' ? input.budget / config.INR_PER_USD : input.budget)
  const lines = await cartLines(user.id)
  if (lines.length === 0) return { budgetUsd: budget, empty: true, summary: 'Your cart is empty — add something first and I will check it against your budget.', suggestions: [], plan: [], aiAssisted: false, auditId: null }

  const price = (ls: Line[]) => priceLines(ls, user.tier, input.region, policyVersion)
  const q = await price(lines)
  const cartIds = lines.map((l) => l.productId)
  const suggestions: Swap[] = []
  for (const l of q.lines) {
    for (const alt of await cheaperAlternatives(l.productId, l.unitPrice, l.quantity, cartIds)) {
      try {
        const nq = await price(swapLines(lines, l.productId, alt.id))
        const saving = round2(q.total - nq.total)
        if (saving <= 0) continue
        suggestions.push({ replaceProductId: l.productId, replaceName: l.name, quantity: l.quantity, with: alt, saving, newTotal: nq.total, reason: `Same category, ${alt.rating.toFixed(1)}★ (${alt.ratingCount} ratings), ${alt.availability === 'LOW_STOCK' ? 'low stock' : 'in stock'}` })
      } catch {
        // the alternative can't ship together with the rest of the cart from one centre
      }
    }
  }

  // plan: if one swap fixes the budget, take the smallest such saving (least downgrade); otherwise
  // take the biggest saving and repeat on the remaining lines. Totals are re-quoted, never summed.
  const plan: Swap[] = []
  let current = lines
  let total = q.total
  const remaining = new Set(suggestions.map((s) => s.replaceProductId))
  while (total > budget && remaining.size > 0) {
    const options: Swap[] = []
    const inCart = new Set(current.map((l) => l.productId))
    for (const s of suggestions.filter((x) => remaining.has(x.replaceProductId) && !inCart.has(x.with.id))) {
      const nq = await price(swapLines(current, s.replaceProductId, s.with.id)).catch(() => null)
      if (nq && nq.total < total) options.push({ ...s, saving: round2(total - nq.total), newTotal: nq.total })
    }
    if (options.length === 0) break
    const fits = options.filter((o) => o.newTotal <= budget).sort((a, b) => a.saving - b.saving || b.with.rating - a.with.rating)
    const pick = fits[0] ?? options.sort((a, b) => b.saving - a.saving)[0]!
    plan.push(pick)
    current = swapLines(current, pick.replaceProductId, pick.with.id)
    total = pick.newTotal
    remaining.delete(pick.replaceProductId)
  }

  const deterministic = summaryText(budget, q, plan, total)
  let summary = deterministic
  let aiAssisted = false
  let error: string | null = null
  if (nvidiaConfigured()) {
    try {
      const facts = JSON.stringify({ budgetUsd: budget, cartTotal: q.total, shipping: q.shippingExplanation, discount: q.discount, plan: plan.map((s) => ({ replace: s.replaceName, with: s.with.name, saving: s.saving, newTotal: s.newTotal })), finalTotal: total })
      const text = (await chatText(models.fast(), `Facts: ${facts}\nWrite 2-3 friendly sentences for the shopper explaining their cart against their budget and the suggested swaps. Use only these numbers, in US dollars. Say nothing changes until they approve.`, 'You are a careful checkout assistant. Never invent prices, products or fees.')).trim()
      if (text && numbersGrounded(text, facts + deterministic)) {
        summary = text
        aiAssisted = true
      } else error = 'LLM summary cited numbers not in the quote; used template'
    } catch (e) {
      error = (e as Error).message
      logger.warn({ err: error }, 'checkout summary LLM failed')
    }
  }

  const response = {
    budgetUsd: budget,
    budget: { amount: input.budget, currency: input.currency },
    empty: false,
    total: q.total,
    subtotal: q.subtotal,
    discount: q.discount,
    shippingFee: q.shippingFee,
    shippingExplanation: q.shippingExplanation,
    shippingPolicy: q.shippingPolicy,
    withinBudget: q.total <= budget,
    overBudgetBy: round2(Math.max(0, q.total - budget)),
    suggestions: suggestions.sort((a, b) => b.saving - a.saving).slice(0, 8),
    plan,
    planTotal: total,
    planWithinBudget: total <= budget,
    summary,
    aiAssisted,
    auditId: null as string | null,
  }
  response.auditId = await recordAudit({
    conversationId,
    userId: user.id,
    agent: 'CHECKOUT',
    intent: 'BUDGET_CHECK',
    input: `budget ${input.budget} ${input.currency}`,
    extractedParams: { budgetUsd: budget, region: input.region },
    retrievedIds: suggestions.map((s) => s.with.id),
    output: { total: q.total, plan: plan.map((s) => [s.replaceProductId, s.with.id, s.saving]), planTotal: total },
    model: aiAssisted ? config.NVIDIA_FAST_MODEL : null,
    latencyMs: Date.now() - started,
    error,
  })
  return response
}
