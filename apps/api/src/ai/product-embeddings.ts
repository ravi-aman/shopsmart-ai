import { config, nvidiaConfigured } from '../config.js'
import { logger } from '../logger.js'
import { Product } from '../models/index.js'
import { embedMany } from './nvidia.js'

let running = false

export function productText(r: { name: string; brand: string; categoryName: string; description: string; specs: Record<string, unknown>; tags: string[] }) {
  const specs = Object.entries(r.specs ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ')
  return `${r.name}. Brand: ${r.brand}. Category: ${r.categoryName}. ${r.description}${specs ? ` Specs: ${specs}` : ''}${r.tags?.length ? `. Tags: ${r.tags.join(', ')}` : ''}`
}

/** Embeds every active product without a vector so "good for AI projects" matches semantically. */
export async function embedMissingProducts(): Promise<number> {
  if (running || !nvidiaConfigured()) return 0
  running = true
  try {
    let total = 0
    for (;;) {
      const rows = await Product.find({ status: 'ACTIVE', embedding: { $exists: false } }).limit(32).lean()
      if (rows.length === 0) return total
      const vectors = await embedMany(rows.map((r) => productText(r as never)), 'passage')
      await Product.bulkWrite(rows.map((r, i) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { embedding: vectors[i] } } } })))
      total += rows.length
    }
  } finally {
    running = false
  }
}

export const missingProductEmbeddings = () => Product.countDocuments({ status: 'ACTIVE', embedding: { $exists: false } })

export function embedProductsInBackground() {
  if (!nvidiaConfigured()) {
    logger.info('NVIDIA_API_KEY not set: product embeddings skipped, assistant uses keyword retrieval only')
    return
  }
  embedMissingProducts()
    .then((n) => n > 0 && logger.info({ n, model: config.NVIDIA_EMBEDDING_MODEL }, 'embedded products'))
    .catch((e) => logger.warn({ err: e.message }, 'product embedding failed; keyword retrieval only'))
}
