import { Product, User } from '../models/index.js'
import { availabilityStages, findByIdOrSlug, toSummary } from '../modules/catalog/repository.js'
import { notFound } from '../http/errors.js'
import { round2 } from '../modules/cart.js'
import { recordAudit } from './audit.js'

type Range = [number, number]
type Measurements = { chestCm?: number | null; waistCm?: number | null; footLengthCm?: number | null }

/** How far a measurement is outside a size's range (0 = inside). */
const outside = (v: number, [lo, hi]: Range) => (v < lo ? lo - v : v > hi ? v - hi : 0)

/**
 * Size suggestion from the manufacturer's chart. Deterministic and explicit about uncertainty:
 * it never claims a fit it can't support, and says when the shopper is between sizes.
 */
export async function fitAdvice(userId: string, productKey: string, override: Measurements | null) {
  const started = Date.now()
  const p = await findByIdOrSlug(productKey)
  if (!p) throw notFound('Product not found')
  const chart = p.sizeChart as Record<string, Record<string, Range>> | null
  if (!chart) return { productId: p.summary.id, supported: false, message: 'This product has no size chart, so I cannot suggest a size.' }
  const saved = (await User.findById(userId).select('measurements').lean())?.measurements ?? {}
  const m: Measurements = { ...saved, ...Object.fromEntries(Object.entries(override ?? {}).filter(([, v]) => v != null)) }
  const dims = Object.keys(Object.values(chart)[0] ?? {}) as (keyof Measurements)[]
  const have = dims.filter((d) => typeof m[d] === 'number')
  if (have.length === 0) {
    return { productId: p.summary.id, supported: true, needsMeasurements: dims, message: `Add your ${dims.map((d) => d.replace('Cm', '').replace(/([A-Z])/g, ' $1').toLowerCase()).join(' and ')} in centimetres to get a size suggestion.` }
  }
  const scored = Object.entries(chart)
    .map(([size, ranges]) => ({ size, off: round2(have.reduce((n, d) => n + outside(m[d] as number, ranges[d]!), 0)), ranges }))
    .sort((a, b) => a.off - b.off)
  const best = scored[0]!
  const second = scored[1]
  const between = !!second && best.off > 0 && second.off - best.off <= 2
  const confidence = best.off === 0 && have.length === dims.length ? 'HIGH' : best.off <= 2 ? 'MEDIUM' : 'LOW'
  const notes: string[] = []
  if (have.length < dims.length) notes.push(`Based on ${have.join(', ')} only — add ${dims.filter((d) => !have.includes(d)).join(', ')} for a better match.`)
  if (between) notes.push(`You are between ${best.size} and ${second!.size}; pick ${second!.size} for a looser fit.`)
  if (best.off > 2) notes.push('Your measurements are outside this chart — the closest size may not fit well.')
  notes.push('Sizes come from the manufacturer chart; fit varies by cut and fabric.')
  const out = {
    productId: p.summary.id,
    supported: true,
    suggestedSize: best.size,
    alternativeSize: between ? second!.size : null,
    confidence,
    usedMeasurements: Object.fromEntries(have.map((d) => [d, m[d]])),
    chart,
    notes,
    message: `${confidence === 'LOW' ? 'Closest size' : 'Suggested size'}: ${best.size}.`,
    auditId: null as string | null,
  }
  out.auditId = await recordAudit({ userId, agent: 'PREMIUM', intent: 'FIT_ADVICE', input: p.summary.id, extractedParams: out.usedMeasurements, output: { size: best.size, confidence }, confidence, latencyMs: Date.now() - started })
  return out
}

/** Accessories that go with a product's category. */
const COMPANIONS: Record<string, string[]> = {
  laptops: ['mobile-accessories', 'audio', 'programming-books'],
  smartphones: ['mobile-accessories', 'audio'],
  tablets: ['mobile-accessories', 'audio'],
  audio: ['mobile-accessories'],
  'mens-clothing': ['footwear', 'watches', 'eyewear'],
  'womens-clothing': ['bags-jewellery', 'footwear', 'watches'],
  footwear: ['mens-clothing', 'womens-clothing'],
  kitchen: ['fresh-pantry'],
  'programming-books': ['ai-data-books'],
  'ai-data-books': ['programming-books'],
}

/** Premium "complete the set": best-rated in-stock companions, priced deterministically by the server. */
export async function bundleFor(userId: string, productKey: string) {
  const started = Date.now()
  const p = await findByIdOrSlug(productKey)
  if (!p) throw notFound('Product not found')
  const cats = COMPANIONS[p.category] ?? []
  const picks = []
  for (const c of cats) {
    const [row] = await Product.aggregate([
      { $match: { status: 'ACTIVE', category: c, price: { $lte: Math.max(30, p.summary.price * 0.5) } } },
      ...availabilityStages,
      { $match: { available: { $gt: 0 } } },
      { $sort: { rating: -1, ratingCount: -1 } },
      { $limit: 1 },
    ])
    if (row) picks.push(toSummary(row))
  }
  const items = [p.summary, ...picks]
  const subtotal = round2(items.reduce((n, i) => n + i.price, 0))
  const out = {
    anchor: p.summary,
    companions: picks,
    estimatedTotal: subtotal,
    note: picks.length ? 'Estimate at list prices — promotions, clearance discounts, stock and delivery fees are confirmed at checkout.' : 'No companion products found for this item.',
    auditId: null as string | null,
  }
  out.auditId = await recordAudit({ userId, agent: 'PREMIUM', intent: 'BUNDLE', input: p.summary.id, retrievedIds: picks.map((x) => x.id), output: { total: out.estimatedTotal }, latencyMs: Date.now() - started })
  return out
}
