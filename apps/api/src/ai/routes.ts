import { Router } from 'express'
import { z } from 'zod'
import { ApiError, handler, notFound, parse } from '../http/errors.js'
import { requireUser, signedIn, staffOnly } from '../http/auth.js'
import { openSse } from '../http/sse.js'
import { recommend } from '../shopping/service.js'
import { findDecision, saveFeedback } from './audit.js'
import { embedMissingProducts, missingProductEmbeddings } from './product-embeddings.js'
import { checkRateLimit } from './rate-limit.js'

const recommendSchema = z.object({
  query: z.string().trim().min(1, 'must not be blank').max(500),
  conversationId: z.string().max(64).nullish(),
})

export const aiRouter = Router()

/** Module 1 contract in one response. Works signed out; signed-in shoppers get their preferences applied. */
aiRouter.post(
  '/api/ai/shopping/recommend',
  handler(async (req, res) => {
    const body = parse(recommendSchema, req.body)
    await checkRateLimit(req)
    res.json(await recommend(body.query, body.conversationId ?? null, req.user?.id ?? null, () => {}))
  }),
)

/** Same pipeline as server-sent events: `step` events, then one `result` (or `error`). */
aiRouter.post(
  '/api/ai/shopping/stream',
  handler(async (req, res) => {
    const body = parse(recommendSchema, req.body)
    await checkRateLimit(req)
    const sse = openSse(res)
    try {
      sse.send('result', await recommend(body.query, body.conversationId ?? null, req.user?.id ?? null, (s) => sse.send('step', s)))
    } catch (e) {
      console.error('[shopping] assistant failed', e)
      sse.send('error', e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'ASSISTANT_FAILED', message: 'The assistant hit a problem. Please try again.' })
    }
    sse.end()
  }),
)

/** "Why this?" trace. Owners see their own; anonymous traces are visible by id; staff see all. */
aiRouter.get(
  '/api/ai/decisions/:id',
  handler(async (req, res) => {
    const id = String(req.params.id)

    const entry = await findDecision(id)
    if (!entry) throw notFound('Decision not found')
    if (entry.userId) {
      const me = req.user
      const staff = me && me.role !== 'CUSTOMER'
      if (!me || !(staff || me.id === entry.userId)) throw notFound('Decision not found')
    }
    const { userId: _owner, ...trace } = entry
    res.json(trace)
  }),
)

const feedbackSchema = z.object({ rating: z.union([z.literal(1), z.literal(-1)], { message: 'must be 1 or -1' }), comment: z.string().max(500).nullish() })

aiRouter.post(
  '/api/ai/decisions/:id/feedback',
  signedIn,
  handler(async (req, res) => {
    const body = parse(feedbackSchema, req.body)
    const id = String(req.params.id)
    if (!(await findDecision(id))) throw notFound('Decision not found')
    await saveFeedback(id, requireUser(req).id, body.rating, body.comment ?? null)
    res.status(204).end()
  }),
)

aiRouter.post(
  '/api/ai/admin/embed-products',
  staffOnly,
  handler(async (_req, res) => {
    const embedded = await embedMissingProducts()
    res.json({ embedded, stillMissing: await missingProductEmbeddings() })
  }),
)
