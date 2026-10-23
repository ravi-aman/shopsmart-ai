import mongoose from 'mongoose'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { AiAudit, AiFeedback } from '../models/index.js'

export interface AuditEntry {
  conversationId?: string | null
  userId?: string | null
  agent: 'SHOPPING' | 'KNOWLEDGE' | 'ORDER' | 'OPS' | 'CHECKOUT' | 'PREMIUM'
  intent: string
  input: string
  extractedParams?: unknown
  toolCalls?: unknown[]
  retrievedIds?: string[]
  output?: unknown
  confidence?: string | null
  model?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  latencyMs: number
  error?: string | null
}

/** Illustrative cost from configurable per-token rates — an estimate, not a bill. */
export const estimateCost = (input: number | null | undefined, output: number | null | undefined) =>
  ((input ?? 0) * config.AI_INPUT_COST_PER_1M + (output ?? 0) * config.AI_OUTPUT_COST_PER_1M) / 1_000_000

/** Never throws: an audit failure must not break the shopper's answer. */
export async function recordAudit(e: AuditEntry): Promise<string | null> {
  try {
    const doc = await AiAudit.create({
      conversationId: e.conversationId ?? null,
      user: e.userId && mongoose.isValidObjectId(e.userId) ? e.userId : null,
      agent: e.agent,
      intent: e.intent,
      input: e.input,
      extractedParams: e.extractedParams ?? null,
      toolCalls: e.toolCalls ?? [],
      retrievedIds: e.retrievedIds ?? [],
      output: e.output ?? null,
      confidence: (e.confidence ?? null) as 'HIGH' | 'MEDIUM' | 'LOW' | null,
      model: e.model ?? null,
      promptTokens: e.promptTokens ?? null,
      completionTokens: e.completionTokens ?? null,
      estimatedCostUsd: estimateCost(e.promptTokens, e.completionTokens),
      latencyMs: Math.round(e.latencyMs),
      error: e.error ?? null,
    })
    return String(doc._id)
  } catch (err) {
    logger.error({ err }, 'could not write AI audit entry')
    return null
  }
}

export async function findDecision(id: string) {
  if (!mongoose.isValidObjectId(id)) return null
  const d = await AiAudit.findById(id).lean()
  if (!d) return null
  return {
    id: String(d._id),
    userId: d.user ? String(d.user) : null,
    agent: d.agent,
    intent: d.intent,
    input: d.input,
    extractedParams: d.extractedParams,
    toolCalls: d.toolCalls,
    retrievedIds: d.retrievedIds,
    output: d.output,
    confidence: d.confidence,
    model: d.model,
    promptTokens: d.promptTokens,
    completionTokens: d.completionTokens,
    estimatedCostUsd: d.estimatedCostUsd,
    latencyMs: d.latencyMs,
    error: d.error,
    humanApproved: d.humanApproved,
    createdAt: (d as unknown as { createdAt: Date }).createdAt,
  }
}

export const markApproved = (id: string | null | undefined) =>
  id && mongoose.isValidObjectId(id) ? AiAudit.updateOne({ _id: id }, { $set: { humanApproved: true } }) : Promise.resolve()

export const saveFeedback = (auditId: string, userId: string, rating: number, comment: string | null) =>
  AiFeedback.updateOne({ audit: auditId, user: userId }, { $set: { rating, comment } }, { upsert: true })

export async function listAudit(agent: string | null, confidence: string | null, fallbacksOnly: boolean, limit: number) {
  const match: Record<string, unknown> = {}
  if (agent) match.agent = agent
  if (confidence) match.confidence = confidence
  if (fallbacksOnly) match.error = { $ne: null }
  return AiAudit.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u', pipeline: [{ $project: { email: 1 } }] } },
    { $lookup: { from: 'aifeedbacks', localField: '_id', foreignField: 'audit', as: 'f', pipeline: [{ $project: { rating: 1 } }] } },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        agent: 1,
        intent: 1,
        input: 1,
        confidence: 1,
        model: 1,
        latencyMs: 1,
        fallback: '$error',
        user: { $first: '$u.email' },
        tokens: { $add: [{ $ifNull: ['$promptTokens', 0] }, { $ifNull: ['$completionTokens', 0] }] },
        estimatedCostUsd: 1,
        rating: { $first: '$f.rating' },
        createdAt: 1,
      },
    },
  ])
}

/** Per-user daily AI quota by tier (premium users get more). */
export async function usedToday(userId: string) {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  return AiAudit.countDocuments({ user: userId, createdAt: { $gte: start } })
}
