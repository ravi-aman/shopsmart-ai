import type { PipelineStage } from 'mongoose'
import { capabilities } from '../db.js'
import { Product } from '../models/index.js'
import { availabilityStages, categoryPath, escapeRegex, findByIds, type ProductSummary } from '../modules/catalog/repository.js'
import { vectorNeighbours } from '../ai/vector.js'

const STOP_WORDS = new Set([
  'suggest', 'recommend', 'need', 'want', 'looking', 'find', 'show', 'best', 'good', 'great', 'under', 'below', 'less', 'than',
  'with', 'for', 'and', 'the', 'that', 'this', 'some', 'please', 'can', 'you', 'buy', 'budget', 'within', 'around', 'about',
  'from', 'into', 'will', 'would', 'like', 'also', 'projects', 'project', 'usd', 'mujhe', 'chahiye', 'ke', 'andar', 'ka', 'ki', 'hai',
])

export interface Constraints {
  category: string | null
  minPrice: number | null
  maxPrice: number | null
  minRamGb: number | null
  minStorageGb: number | null
  dedicatedGpu: boolean
  os: string | null
}

export const relaxSpecs = (c: Constraints): Constraints => ({ ...c, minRamGb: null, minStorageGb: null, dedicatedGpu: false, os: null })

export function keywords(text: string) {
  const words = new Set<string>()
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) words.add(w)
  return [...words]
}

async function matchFor(c: Constraints): Promise<Record<string, unknown>> {
  const m: Record<string, unknown> = { status: 'ACTIVE' }
  if (c.category) m.categoryPath = { $regex: `^${escapeRegex((await categoryPath(c.category)) ?? c.category)}(/|$)` }
  if (c.minPrice != null || c.maxPrice != null) m.price = { ...(c.minPrice != null && { $gte: c.minPrice }), ...(c.maxPrice != null && { $lte: c.maxPrice }) }
  if (c.minRamGb != null) m['specs.ramGb'] = { $gte: c.minRamGb }
  if (c.minStorageGb != null) m['specs.storageGb'] = { $gte: c.minStorageGb }
  if (c.dedicatedGpu) m['specs.gpu'] = { $regex: '(rtx|gtx|radeon rx)', $options: 'i' }
  if (c.os) m['specs.os'] = { $regex: escapeRegex(c.os), $options: 'i' }
  return m
}

const inStock: PipelineStage[] = [...availabilityStages, { $match: { available: { $gt: 0 } } }]

export async function countInScope(c: Constraints) {
  const [r] = await Product.aggregate([{ $match: await matchFor(c) }, ...inStock, { $count: 'n' }])
  return r?.n ?? 0
}

/**
 * Hard constraints first (category, budget, specs, in stock), then keyword rank ⊕ embedding rank
 * fused with Reciprocal Rank Fusion (k = 60).
 */
export async function searchCandidates(c: Constraints, text: string, vector: number[] | null, limit: number) {
  const match = await matchFor(c)
  const pool: { _id: string; rating: number; ratingCount: number }[] = await Product.aggregate([{ $match: match }, ...inStock, { $project: { _id: 1, rating: 1, ratingCount: 1 } }])
  if (pool.length === 0) return []
  const ids = pool.map((p) => p._id)

  const words = keywords(text)
  const keywordRank = new Map<string, number>()
  if (words.length) {
    const rows = capabilities.atlasSearch
      ? await Product.aggregate([
          { $search: { index: 'products_search', compound: { should: [{ text: { query: words.join(' '), path: ['name', 'description', 'tags', 'brand'], fuzzy: { maxEdits: 1 } } }], filter: [{ in: { path: '_id', value: ids } }] } } } as PipelineStage,
          { $project: { _id: 1 } },
          { $limit: 100 },
        ]).catch(() => null)
      : null
    const ranked =
      rows ??
      (await Product.aggregate([{ $match: { $text: { $search: words.join(' ') }, _id: { $in: ids } } }, { $sort: { score: { $meta: 'textScore' } } }, { $project: { _id: 1 } }, { $limit: 100 }]))
    ranked.forEach((r: { _id: string }, i: number) => keywordRank.set(r._id, i + 1))
  }

  const vectorRank = new Map<string, number>()
  if (vector) {
    const near = await vectorNeighbours(Product, 'products_vector', vector, { status: 'ACTIVE' }, 200)
    const allowed = new Set(ids)
    near.filter((n) => allowed.has(n.id)).forEach((n, i) => vectorRank.set(n.id, i + 1))
  }

  const fused = pool
    .map((p) => ({
      id: p._id,
      score: (keywordRank.has(p._id) ? 1 / (60 + keywordRank.get(p._id)!) : 0) + (vectorRank.has(p._id) ? 1 / (60 + vectorRank.get(p._id)!) : 0),
      pop: p.rating * Math.log(p.ratingCount + 1),
    }))
    .sort((a, b) => b.score - a.score || b.pop - a.pop || a.id.localeCompare(b.id))
    .slice(0, limit)

  const byId = new Map((await findByIds(fused.map((f) => f.id))).map((p) => [p.id, p]))
  return fused.filter((f) => byId.has(f.id)).map((f) => ({ product: byId.get(f.id)! as ProductSummary, fusedScore: f.score }))
}

export async function cheapestInStock(category: string | null): Promise<ProductSummary | undefined> {
  const [r] = await Product.aggregate([{ $match: await matchFor({ category, minPrice: null, maxPrice: null, minRamGb: null, minStorageGb: null, dedicatedGpu: false, os: null }) }, ...inStock, { $sort: { price: 1 } }, { $limit: 1 }])
  return r ? (await findByIds([r._id]))[0] : undefined
}
