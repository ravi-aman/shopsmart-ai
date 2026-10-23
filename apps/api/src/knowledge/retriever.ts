import { PolicyChunk } from '../models/index.js'
import { vectorNeighbours } from '../ai/vector.js'

const RRF_K = 60
const CATEGORY_BOOST = 0.006

const STOP = new Set([
  'can', 'could', 'would', 'will', 'the', 'a', 'an', 'is', 'are', 'am', 'do', 'does', 'did', 'i', 'my', 'me', 'you', 'your', 'we', 'our', 'it', 'its',
  'this', 'that', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'what', 'whats', 'when', 'how', 'which', 'who', 'why', 'there', 'be', 'if', 'about',
  'any', 'get', 'have', 'has', 'and', 'or', 'please', 'tell', 'shopsmart', 'product', 'item', 'should', 'much', 'many', 'long', 'need', 'want',
  'like', 'just', 'also', 'still', 'know', 'way', 'possible', 'allowed', 'kya', 'hai', 'main', 'mera', 'meri', 'kar', 'sakta', 'sakti', 'ka', 'ki', 'ke',
])

/** Shopper words → the vocabulary policies use. */
const SYNONYMS: Record<string, string> = {
  shoes: 'footwear', shoe: 'footwear', sneakers: 'footwear', clothes: 'fashion', clothing: 'fashion', dress: 'fashion',
  phone: 'smartphones', mobile: 'smartphones', fridge: 'refrigerators', ac: 'air conditioners', headphones: 'audio', earbuds: 'audio',
  money: 'refund', ship: 'shipping', deliver: 'delivery', wapas: 'return', paisa: 'refund', paise: 'refund', vapas: 'return',
}

const HINTS: Record<string, string[]> = {
  return: ['RETURN'], returnable: ['RETURN'], exchange: ['RETURN'], opened: ['RETURN'], refund: ['REFUND'], money: ['REFUND'],
  warranty: ['WARRANTY'], guarantee: ['WARRANTY'], repair: ['WARRANTY'], delivery: ['SHIPPING', 'SLA', 'MEMBERSHIP'], shipping: ['SHIPPING'],
  deliver: ['SHIPPING', 'SLA'], prime: ['MEMBERSHIP'], premium: ['MEMBERSHIP'], membership: ['MEMBERSHIP'], member: ['MEMBERSHIP'],
  cancel: ['CANCELLATION'], cancellation: ['CANCELLATION'], seller: ['SELLER'], setup: ['MANUAL'], ports: ['MANUAL'],
}

/** Content words exactly as written (no synonym expansion). */
export function rawTerms(text: string) {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)))]
}

export const synonymsOf = (word: string) => (SYNONYMS[word] ? SYNONYMS[word].split(' ') : [])

export function contentTerms(text: string) {
  const out = new Set<string>()
  for (const w of rawTerms(text)) {
    out.add(w)
    synonymsOf(w).forEach((s) => out.add(s))
  }
  return [...out]
}

export function categoryHints(text: string) {
  const cats = new Set<string>()
  for (const w of contentTerms(text)) {
    const hit = HINTS[w] ?? (w.endsWith('s') ? HINTS[w.slice(0, -1)] : undefined) ?? (w.endsWith('ed') ? HINTS[w.slice(0, -2)] : undefined)
    hit?.forEach((c) => cats.add(c))
  }
  return cats
}

export interface Hit {
  chunkId: string
  documentId: string
  document: string
  section: string
  version: string
  effectiveDate: string
  category: string
  content: string
  body: string
  keywordRank: number | null
  vectorRank: number | null
  similarity: number | null
  score: number
}

/**
 * Hybrid retrieval over approved, active, in-force sections: full-text rank and embedding rank
 * fused with Reciprocal Rank Fusion, plus a small boost for the policy category the question is
 * about. Tier and region rules are hard filters.
 */
export async function retrieve(question: string, vector: number[] | null, tier: string, region: string | null, limit: number): Promise<Hit[]> {
  const today = new Date().toISOString().slice(0, 10)
  const filter = { active: true, effectiveDate: { $lte: today }, tiers: tier, region: { $in: ['GLOBAL', ...(region ? [region] : [])] } }

  const terms = contentTerms(question)
  const keywordRank = new Map<string, number>()
  if (terms.length) {
    const rows = await PolicyChunk.find({ ...filter, $text: { $search: terms.join(' ') } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(40)
      .select('_id')
      .lean()
    rows.forEach((r, i) => keywordRank.set(String(r._id), i + 1))
  }

  const vectorRank = new Map<string, number>()
  const similarity = new Map<string, number>()
  if (vector) {
    const near = await vectorNeighbours(PolicyChunk, 'chunks_vector', vector, { active: true }, 40)
    near.forEach((n, i) => {
      vectorRank.set(n.id, i + 1)
      similarity.set(n.id, n.similarity)
    })
  }

  const ids = [...new Set([...keywordRank.keys(), ...vectorRank.keys()])]
  if (!ids.length) return []
  const docs = await PolicyChunk.find({ _id: { $in: ids }, ...filter }).lean()
  const hints = categoryHints(question)
  return docs
    .map((d) => {
      const id = String(d._id)
      const kr = keywordRank.get(id) ?? null
      const vr = vectorRank.get(id) ?? null
      return {
        chunkId: id,
        documentId: String(d.document),
        document: d.documentTitle,
        section: d.section,
        version: d.version,
        effectiveDate: d.effectiveDate,
        category: d.category,
        content: d.content,
        body: d.body,
        keywordRank: kr,
        vectorRank: vr,
        similarity: similarity.get(id) ?? null,
        score: (kr ? 1 / (RRF_K + kr) : 0) + (vr ? 1 / (RRF_K + vr) : 0) + (hints.has(d.category) ? CATEGORY_BOOST : 0),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
