import { nvidiaConfigured } from '../config.js'
import { recordAudit } from '../ai/audit.js'
import { embed } from '../ai/nvidia.js'
import type { Progress } from '../http/sse.js'
import { Tracker } from '../http/sse.js'
import { findPreferences } from '../modules/customer.js'
import { cheapestInStock, type Constraints, countInScope, relaxSpecs, searchCandidates } from './candidates.js'
import { extractIntent, has, type ShoppingIntent } from './intent.js'
import { writeReasons } from './reasons.js'
import { score, type Scored } from './scorer.js'

const MAX_RECOMMENDATIONS = 3
const CANDIDATES = 20

export interface RecommendResponse {
  interpretedRequirement: string
  budget: number | null
  recommendations: unknown[]
  clarifyingQuestion: string | null
  summary: string | null
  interpretation: Record<string, unknown>
  notices: string[]
  auditId: string | null
  aiAssisted: boolean
}

const label = (slug: string) => slug.replace(/-/g, ' ')
const plain = (n: number) => String(Number(n.toFixed(2)))

function criteriaLabel(i: ShoppingIntent) {
  if (i.category !== 'laptops') return 'specs, ratings and value'
  const parts = ['RAM', 'CPU', 'storage']
  if (has(i, 'ai-ml') || has(i, 'gaming') || has(i, 'content-creation')) parts.push('GPU')
  if (has(i, 'travel') || has(i, 'student')) parts.push('weight')
  return parts.join(', ')
}

const interpretation = (i: ShoppingIntent, source: string) => ({
  category: i.category,
  budgetMin: i.budgetMin,
  budgetMax: i.budgetMax,
  useCases: i.useCases,
  minRamGb: i.minRamGb,
  minStorageGb: i.minStorageGb,
  needsDedicatedGpu: i.needsDedicatedGpu,
  preferredOs: i.preferredOs,
  brands: i.brands,
  source,
})

/**
 * Module 1: understand → retrieve (SQL + hybrid) → score (deterministic) → explain (LLM, validated)
 * → audit. Each stage reports progress so the UI can show what the assistant is doing.
 */
export async function recommend(text: string, conversationId: string | null, userId: string | null, progress: Progress): Promise<RecommendResponse> {
  const started = Date.now()
  const notices: string[] = []
  const t = new Tracker(progress)

  t.start('understand', 'Understanding your request')
  const extraction = await extractIntent(text)
  let intent = extraction.intent
  const prefs = userId ? await findPreferences(userId) : null
  if (prefs && intent.budgetMax == null && prefs.budgetMax != null && intent.category) {
    intent = { ...intent, budgetMin: prefs.budgetMin, budgetMax: prefs.budgetMax }
    notices.push(`Used your saved budget of up to $${plain(prefs.budgetMax)}.`)
  }
  t.done({ source: extraction.source, category: String(intent.category) })

  const audit = async (response: RecommendResponse, written: Awaited<ReturnType<typeof writeReasons>> | null, candidateIds: string[]) => {
    const errors = [extraction.error && `intent: ${extraction.error}`, written?.error && `explain: ${written.error}`].filter(Boolean)
    const params: Record<string, unknown> = { intent, source: extraction.source, extractionModel: extraction.model }
    if (written?.rejected.length) params.rejectedExplanations = written.rejected
    const sum = (a: number | null, b: number | null | undefined) => (a == null ? (b ?? null) : b == null ? a : a + b)
    const id = await recordAudit({
      conversationId,
      userId,
      agent: 'SHOPPING',
      intent: 'PRODUCT_RECOMMENDATION',
      input: text,
      extractedParams: params,
      toolCalls: t.trace,
      retrievedIds: candidateIds,
      output: response,
      model: written?.model ?? extraction.model,
      promptTokens: sum(extraction.promptTokens, written?.promptTokens),
      completionTokens: sum(extraction.completionTokens, written?.completionTokens),
      latencyMs: Date.now() - started,
      error: errors.length ? errors.join(' | ') : null,
    })
    return { ...response, auditId: id }
  }

  if (!intent.category) {
    return audit(
      {
        interpretedRequirement: intent.interpretedRequirement,
        budget: intent.budgetMax,
        recommendations: [],
        clarifyingQuestion: intent.clarifyingQuestion,
        summary: null,
        interpretation: interpretation(intent, extraction.source),
        notices,
        auditId: null,
        aiAssisted: extraction.source === 'LLM',
      },
      null,
      [],
    )
  }

  const constraints: Constraints = {
    category: intent.category,
    minPrice: intent.budgetMin,
    maxPrice: intent.budgetMax,
    minRamGb: intent.minRamGb,
    minStorageGb: intent.minStorageGb,
    dedicatedGpu: intent.needsDedicatedGpu === true,
    os: intent.preferredOs,
  }
  const inScope = await countInScope(constraints)
  t.start('search', `Searching ${inScope} in-stock ${label(intent.category)}${intent.budgetMax != null ? ` under $${plain(intent.budgetMax)}` : ''}`)
  let vector: number[] | null = null
  if (nvidiaConfigured()) {
    try {
      vector = await embed(text, 'query')
    } catch (e) {
      console.warn(`[shopping] query embedding failed, keyword retrieval only: ${(e as Error).message}`)
    }
  }
  let found = await searchCandidates(constraints, `${text} ${intent.useCases.join(' ')}`, vector, CANDIDATES)
  const hasSpecs = constraints.minRamGb != null || constraints.minStorageGb != null || constraints.dedicatedGpu || constraints.os != null
  if (found.length < MAX_RECOMMENDATIONS && hasSpecs) {
    const relaxed = await searchCandidates(relaxSpecs(constraints), text, vector, CANDIDATES)
    if (relaxed.length > found.length) {
      notices.push('Few products met every spec you listed, so I also included close matches.')
      found = relaxed
    }
  }
  if (found.length === 0 && intent.budgetMax != null) {
    const stretched = Math.round(intent.budgetMax * 1.15)
    found = await searchCandidates({ ...relaxSpecs(constraints), minPrice: null, maxPrice: stretched }, text, vector, CANDIDATES)
    if (found.length) notices.push(`Nothing in stock fit within $${plain(intent.budgetMax)}, so these go up to $${stretched}.`)
  }
  t.done({ candidates: found.length, hybrid: vector != null })

  if (found.length === 0) {
    const cheapest = await cheapestInStock(intent.category)
    const question = cheapest
      ? `The lowest-priced in-stock option in ${label(intent.category)} is the ${cheapest.name} at $${plain(cheapest.price)}. Would you like to see options in that range?`
      : `Nothing in ${label(intent.category)} is in stock right now. Would you like to try a different category?`
    return audit(
      {
        interpretedRequirement: intent.interpretedRequirement,
        budget: intent.budgetMax,
        recommendations: [],
        clarifyingQuestion: question,
        summary: null,
        interpretation: interpretation(intent, extraction.source),
        notices,
        auditId: null,
        aiAssisted: extraction.source === 'LLM',
      },
      null,
      [],
    )
  }

  t.start('score', `Comparing ${found.length} candidates on ${criteriaLabel(intent)}`)
  const scored: Scored[] = found
    .map((c) => score(c.product, intent, prefs?.preferredBrands ?? []))
    .sort((a, b) => b.score - a.score || b.product.rating - a.product.rating)
  const picks = scored.slice(0, MAX_RECOMMENDATIONS)
  t.done({ top: picks.map((p) => `${p.product.id}:${p.score}`) })

  t.start('explain', 'Explaining the picks')
  const written = await writeReasons(text, intent, picks)
  t.done({ model: String(written.model), rejectedExplanations: written.rejected.length })

  const recommendations = picks.map((s) => ({
    productId: s.product.id,
    productName: s.product.name,
    reason: s.reasonParts.length ? s.reasonParts.join(', ') : `${s.product.brand} ${s.product.categoryName}`,
    availability: s.product.availability,
    explanation: written.explanations[s.product.id] ?? null,
    slug: s.product.slug,
    brand: s.product.brand,
    price: s.product.price,
    mrp: s.product.mrp,
    currency: s.product.currency,
    image: s.product.image,
    rating: s.product.rating,
    score: s.score,
    matchedRequirements: s.matchedRequirements,
    tradeoffs: s.tradeoffs,
    scoreBreakdown: s.breakdown,
  }))

  if (!nvidiaConfigured()) notices.push('AI model not connected — showing rule-based results.')
  return audit(
    {
      interpretedRequirement: intent.interpretedRequirement,
      budget: intent.budgetMax,
      recommendations,
      clarifyingQuestion: null,
      summary: written.summary,
      interpretation: interpretation(intent, extraction.source),
      notices,
      auditId: null,
      aiAssisted: extraction.source === 'LLM' || (written.error == null && written.model != null),
    },
    written,
    scored.map((s) => s.product.id),
  )
}
