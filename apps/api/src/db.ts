import mongoose from 'mongoose'
import { config } from './config.js'
import { logger } from './logger.js'

/**
 * MongoDB connection plus capability detection. Atlas (and the mongodb-atlas-local image) support
 * Atlas Search ($search, fuzzy) and Vector Search ($vectorSearch); a plain mongod does not, so the
 * app checks once and falls back to $text + in-process cosine similarity.
 */
export const capabilities = { atlasSearch: false, vectorSearch: false, transactions: false }

export async function connectDb() {
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.MONGODB_URI, { dbName: config.MONGODB_DB, serverSelectionTimeoutMS: 15_000, maxPoolSize: 20 })
  const admin = mongoose.connection.db!.admin()
  try {
    const hello = await admin.command({ hello: 1 })
    capabilities.transactions = Boolean(hello.setName || hello.msg === 'isdbgrid')
  } catch {
    capabilities.transactions = false
  }
  logger.info({ db: config.MONGODB_DB, transactions: capabilities.transactions }, 'mongodb connected')
}

export async function syncIndexes() {
  for (const model of Object.values(mongoose.models)) await model.syncIndexes()
}

interface SearchIndexDef {
  collection: string
  name: string
  type: 'search' | 'vectorSearch'
  definition: Record<string, unknown>
}

const searchIndexes = (): SearchIndexDef[] => [
  {
    collection: 'products',
    name: 'products_search',
    type: 'search',
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          name: { type: 'string' },
          brand: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'string' },
          status: { type: 'token' },
          categoryPath: { type: 'token' },
        },
      },
    },
  },
  {
    collection: 'products',
    name: 'products_vector',
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: config.EMBEDDING_DIMENSIONS, similarity: 'cosine' },
        { type: 'filter', path: 'status' },
        { type: 'filter', path: 'categoryPath' },
      ],
    },
  },
  {
    collection: 'policychunks',
    name: 'chunks_vector',
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: config.EMBEDDING_DIMENSIONS, similarity: 'cosine' },
        { type: 'filter', path: 'active' },
      ],
    },
  },
]

/** Creates Atlas Search / Vector Search indexes when the server supports them. Safe to call on every start. */
export async function ensureSearchIndexes() {
  const db = mongoose.connection.db!
  for (const idx of searchIndexes()) {
    try {
      const col = db.collection(idx.collection)
      const existing = await col.listSearchIndexes(idx.name).toArray()
      if (existing.length === 0) {
        await col.createSearchIndex({ name: idx.name, type: idx.type, definition: idx.definition })
        logger.info({ index: idx.name }, 'created search index')
      } else if (idx.type === 'vectorSearch') {
        // the embedding model changed size: rebuild the index and drop vectors of the old size
        const dims = ((existing[0] as { latestDefinition?: unknown }).latestDefinition as { fields?: { type: string; numDimensions?: number }[] })?.fields?.find((f) => f.type === 'vector')?.numDimensions
        if (dims && dims !== config.EMBEDDING_DIMENSIONS) {
          await col.updateSearchIndex(idx.name, idx.definition)
          await col.updateMany({ embedding: { $exists: true } }, { $unset: { embedding: '' } })
          logger.info({ index: idx.name, from: dims, to: config.EMBEDDING_DIMENSIONS }, 'vector index resized; embeddings will be recomputed')
        }
      }
      if (idx.type === 'search') capabilities.atlasSearch = true
      else capabilities.vectorSearch = true
    } catch (e) {
      logger.warn({ index: idx.name, err: (e as Error).message }, 'search indexes unavailable — using $text and in-process vector fallback')
      return
    }
  }
}

/** True once an Atlas search index has finished building (queries before that return nothing). */
export async function searchIndexReady(collection: string, name: string) {
  try {
    const [idx] = await mongoose.connection.db!.collection(collection).listSearchIndexes(name).toArray()
    return Boolean((idx as { queryable?: boolean } | undefined)?.queryable)
  } catch {
    return false
  }
}

/** Runs fn in a transaction when the deployment supports it (replica set / Atlas), otherwise directly. */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession | null) => Promise<T>): Promise<T> {
  if (!capabilities.transactions) return fn(null)
  const session = await mongoose.startSession()
  try {
    let result!: T
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result
  } finally {
    await session.endSession()
  }
}
