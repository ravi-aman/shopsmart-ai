import { Router } from 'express'
import mongoose from 'mongoose'
import { config, nvidiaConfigured, smtpConfigured } from '../config.js'
import { capabilities } from '../db.js'
import { handler, notFound } from '../http/errors.js'
import { PolicyChunk, Product } from '../models/index.js'
import { chatText, embed, models } from '../ai/nvidia.js'
import { ENDPOINTS } from './endpoints.js'

export const healthRouter = Router()

/** Database reachability, search capabilities, seeded counts and which integrations are configured. */
healthRouter.get(
  '/api/health',
  handler(async (_req, res) => {
    const info = await mongoose.connection.db!.admin().command({ buildInfo: 1 })
    res.json({
      status: 'UP',
      database: `MongoDB ${info.version}`,
      search: capabilities.atlasSearch ? 'Atlas Search' : 'text index',
      vectorSearch: capabilities.vectorSearch ? 'Atlas Vector Search' : 'in-process cosine',
      transactions: capabilities.transactions,
      products: await Product.estimatedDocumentCount(),
      knowledgeChunks: await PolicyChunk.estimatedDocumentCount(),
      ai: nvidiaConfigured() ? `NVIDIA (${config.NVIDIA_AGENT_MODEL})` : 'fallback (no NVIDIA_API_KEY)',
      email: smtpConfigured() ? 'SMTP' : 'disabled (no SMTP_HOST) — emails are logged and marked SKIPPED',
    })
  }),
)

healthRouter.get('/api', (_req, res) => {
  res.json({ name: 'ShopSmart AI API', endpoints: ENDPOINTS })
})

/** One chat and one embedding round-trip to NVIDIA. Off unless DEV_ENDPOINTS_ENABLED=true. */
healthRouter.get(
  '/api/health/ai',
  handler(async (_req, res) => {
    if (!config.DEV_ENDPOINTS_ENABLED) throw notFound('AI health check is disabled')
    const t0 = Date.now()
    const reply = await chatText(models.fast(), 'Reply with exactly the word OK.')
    const t1 = Date.now()
    const vector = await embed('Can I return an opened laptop?', 'query')
    res.json({
      chatModel: config.NVIDIA_FAST_MODEL,
      chatReply: reply,
      chatLatencyMs: t1 - t0,
      embeddingModel: config.NVIDIA_EMBEDDING_MODEL,
      embeddingDimensions: vector.length,
      embeddingLatencyMs: Date.now() - t1,
    })
  }),
)
