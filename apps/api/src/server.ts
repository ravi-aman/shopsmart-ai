import path from 'node:path'
import mongoose from 'mongoose'
import { embedProductsInBackground } from './ai/product-embeddings.js'
import { createApp } from './app.js'
import { config } from './config.js'
import { connectDb, ensureSearchIndexes, syncIndexes } from './db.js'
import { logger } from './logger.js'
import { seedCatalog } from './seed/catalog.js'
import { seedSalesHistory } from './seed/ops.js'
import { startJobs, stopJobs } from './jobs/index.js'
import { embedMissingChunks, seedKnowledge } from './knowledge/ingestion.js'

const root = path.resolve(import.meta.dirname, '..')

async function main() {
  await connectDb()
  await syncIndexes()
  await seedCatalog(path.join(root, 'seed'))
  await seedSalesHistory()
  await seedKnowledge(path.join(root, 'seed'))
  await ensureSearchIndexes()

  const app = createApp()
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'))
  embedProductsInBackground()
  embedMissingChunks().catch((e) => logger.warn({ err: e.message }, 'chunk embedding failed; keyword search only'))
  startJobs()

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    logger.info('shutting down')
    stopJobs()
    server.close()
    await mongoose.disconnect().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  logger.fatal({ err: e }, 'failed to start')
  process.exit(1)
})
