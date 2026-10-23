import { Router } from 'express'
import { z } from 'zod'
import { premiumOnly, requireUser, signedIn } from '../http/auth.js'
import { ApiError, handler, parse } from '../http/errors.js'
import { openSse } from '../http/sse.js'
import { answerQuestion } from '../knowledge/answer.js'
import { logger } from '../logger.js'
import { REGIONS } from '../models/index.js'
import { answerOrderQuestion, looksLikeOrderQuestion } from '../orders/agent.js'
import { recommend } from '../shopping/service.js'
import { assistCheckout } from './checkout.js'
import { bundleFor, fitAdvice } from './premium.js'
import { checkRateLimit } from './rate-limit.js'

export type Agent = 'SHOPPING' | 'KNOWLEDGE' | 'ORDER'

const POLICY = new Set(['return', 'returns', 'returnable', 'returned', 'refund', 'refunds', 'warranty', 'guarantee', 'cancel', 'cancellation', 'cancelled', 'shipping', 'ship', 'shipped', 'shipment', 'delivery', 'deliver', 'delivered', 'membership', 'member', 'prime', 'premium', 'policy', 'policies', 'exchange', 'replacement', 'replace', 'seller', 'sellers', 'sla', 'manual', 'setup', 'ports', 'claim', 'repair', 'fee', 'fees', 'wapas', 'paisa'])
const SHOPPING = new Set(['suggest', 'recommend', 'recommendation', 'best', 'buy', 'looking', 'need', 'want', 'cheap', 'budget', 'under', 'below', 'compare', 'options', 'show', 'find', 'gift', 'top', 'chahiye', 'chaiye', 'dikhao', 'andar', 'sasta'])

/**
 * Deterministic routing (instant and auditable): the shopper's own orders go to the order agent;
 * policy vocabulary goes to the knowledge agent unless it is clearly a buying request.
 */
export function route(message: string, hasProductContext: boolean): Agent {
  if (!hasProductContext && looksLikeOrderQuestion(message)) return 'ORDER'
  const q = message.toLowerCase()
  let policy = 0
  let shopping = 0
  for (const w of q.split(/[^a-z0-9$₹]+/)) {
    if (POLICY.has(w)) policy++
    if (SHOPPING.has(w)) shopping++
  }
  if (/[$₹]|\brs\.?\s?\d/.test(q)) shopping++
  if (policy === 0) return 'SHOPPING'
  if (hasProductContext || shopping === 0) return 'KNOWLEDGE'
  return policy >= shopping ? 'KNOWLEDGE' : 'SHOPPING'
}

export const assistantRouter = Router()

const messageSchema = z.object({
  message: z.string().trim().min(1).max(600),
  productId: z.string().max(20).nullish(),
  conversationId: z.string().max(64).nullish(),
})

/** One entry point for the assistant drawer. Events: route, step…, then result or error. */
assistantRouter.post(
  '/api/ai/assistant/stream',
  handler(async (req, res) => {
    const body = parse(messageSchema, req.body)
    await checkRateLimit(req)
    const user = req.user ?? null
    const agent = route(body.message, !!body.productId)
    const sse = openSse(res)
    const step = (s: unknown) => sse.send('step', s)
    try {
      sse.send('route', { agent })
      const conv = body.conversationId ?? null
      const data =
        agent === 'SHOPPING'
          ? await recommend(body.message, conv, user?.id ?? null, step)
          : agent === 'KNOWLEDGE'
            ? await answerQuestion(body.message, body.productId ?? null, conv, user, step)
            : await answerOrderQuestion(body.message, user, conv, step)
      sse.send('result', { agent, data })
    } catch (e) {
      if (!(e instanceof ApiError)) logger.error({ err: e }, 'assistant failed')
      sse.send('error', e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'ASSISTANT_FAILED', message: 'The assistant hit a problem. Please try again.' })
    }
    sse.end()
  }),
)

assistantRouter.post(
  '/api/ai/orders/ask',
  signedIn,
  handler(async (req, res) => {
    const body = parse(messageSchema, req.body)
    await checkRateLimit(req)
    res.json(await answerOrderQuestion(body.message, requireUser(req), body.conversationId ?? null, () => {}))
  }),
)

/** Budget check on the current cart; proposes swaps, never edits the cart. */
assistantRouter.post(
  '/api/ai/checkout/assist',
  signedIn,
  handler(async (req, res) => {
    const body = parse(
      z.object({ budget: z.number().positive().max(10_000_000), currency: z.enum(['USD', 'INR']).default('USD'), region: z.enum(REGIONS), conversationId: z.string().max(64).nullish() }),
      req.body,
    )
    await checkRateLimit(req)
    res.json(await assistCheckout(requireUser(req), body, body.conversationId ?? null))
  }),
)

const measurement = z.number().min(10).max(250).nullish()

assistantRouter.post(
  '/api/ai/premium/fit',
  premiumOnly,
  handler(async (req, res) => {
    const body = parse(z.object({ productId: z.string().min(1).max(120), measurements: z.object({ chestCm: measurement, waistCm: measurement, footLengthCm: z.number().min(10).max(40).nullish() }).nullish() }), req.body)
    await checkRateLimit(req)
    res.json(await fitAdvice(requireUser(req).id, body.productId, body.measurements ?? null))
  }),
)

assistantRouter.post(
  '/api/ai/premium/bundle',
  premiumOnly,
  handler(async (req, res) => {
    const body = parse(z.object({ productId: z.string().min(1).max(120) }), req.body)
    await checkRateLimit(req)
    res.json(await bundleFor(requireUser(req).id, body.productId))
  }),
)
