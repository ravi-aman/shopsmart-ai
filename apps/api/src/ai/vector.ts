import type { Model } from 'mongoose'
import { capabilities, searchIndexReady } from '../db.js'

export function cosine(a: number[], b: number[]) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/**
 * Nearest neighbours by cosine similarity. Uses Atlas $vectorSearch when the index exists and is
 * queryable; otherwise scores the (pre-filtered, bounded) candidate set in process.
 */
export async function vectorNeighbours(
  model: Model<any>,
  index: string,
  vector: number[],
  filter: Record<string, unknown>,
  limit: number,
): Promise<{ id: string; similarity: number }[]> {
  if (capabilities.vectorSearch && (await searchIndexReady(model.collection.collectionName, index))) {
    const rows = await model.aggregate([
      { $vectorSearch: { index, path: 'embedding', queryVector: vector, numCandidates: Math.max(100, limit * 10), limit, filter } },
      { $project: { _id: 1, similarity: { $meta: 'vectorSearchScore' } } },
    ])
    // Atlas cosine score is (1 + cos) / 2; convert back to cosine for consistent thresholds
    return rows.map((r) => ({ id: String(r._id), similarity: r.similarity * 2 - 1 }))
  }
  const docs = await model
    .find({ ...filter, embedding: { $exists: true } })
    .select('+embedding')
    .limit(5000)
    .lean()
  return docs
    .map((d: any) => ({ id: String(d._id), similarity: cosine(vector, d.embedding as number[]) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}
