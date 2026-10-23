import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { isStaff, requireUser, signedIn, staffOnly } from '../http/auth.js'
import { ApiError, handler, notFound, parse } from '../http/errors.js'
import { AiAudit, Order, SupportCase } from '../models/index.js'
import { notify, notifyStaff } from '../notifications/service.js'

export const supportRouter = Router()

const caseJson = (c: Record<string, any>) => ({
  id: String(c._id),
  subject: c.subject,
  status: c.status,
  priority: c.priority,
  source: c.source,
  orderId: c.order,
  aiDecisionId: c.aiDecision ? String(c.aiDecision) : null,
  messages: c.messages,
  customer: c.u?.[0] ? { name: c.u[0].name, email: c.u[0].email, tier: c.u[0].membershipTier } : undefined,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
})

async function loadCase(req: Parameters<typeof requireUser>[0]) {
  const u = requireUser(req)
  const id = String(req.params.id)
  if (!mongoose.isValidObjectId(id)) throw notFound('Case not found')
  const c = await SupportCase.findById(id).lean()
  // customers see only their own cases
  if (!c || (!isStaff(u) && String(c.user) !== u.id)) throw notFound('Case not found')
  return { u, c }
}

/**
 * Opens a case. When it follows up a LOW-confidence AI answer (aiDecisionId), the case records the
 * decision so staff see what the assistant said, and it is marked AI_FOLLOW_UP with high priority.
 */
supportRouter.post(
  '/api/support/cases',
  signedIn,
  handler(async (req, res) => {
    const b = parse(z.object({ subject: z.string().trim().min(3).max(200), message: z.string().trim().min(3).max(2000), orderId: z.string().regex(/^ORD-\d{6}$/i).nullish(), aiDecisionId: z.string().regex(/^[a-f0-9]{24}$/).nullish() }), req.body)
    const u = requireUser(req)
    if (b.orderId && !(await Order.exists({ _id: b.orderId.toUpperCase(), user: u.id }))) throw notFound(`Order ${b.orderId} not found`)
    let source: 'USER' | 'AI_FOLLOW_UP' = 'USER'
    let priority: 'NORMAL' | 'HIGH' = 'NORMAL'
    const messages: { from: 'USER' | 'AGENT' | 'SYSTEM'; author: string; text: string; at: Date }[] = [{ from: 'USER', author: u.name, text: b.message, at: new Date() }]
    if (b.aiDecisionId) {
      const d = await AiAudit.findById(b.aiDecisionId).select('user input output confidence agent').lean()
      if (!d || (d.user && String(d.user) !== u.id)) throw notFound('AI decision not found')
      source = 'AI_FOLLOW_UP'
      if (d.confidence === 'LOW') priority = 'HIGH'
      const said = (d.output as { answer?: string } | null)?.answer
      messages.unshift({ from: 'SYSTEM', author: 'ShopSmart AI', text: `Question: ${d.input}\nAssistant answer (${d.confidence ?? 'n/a'} confidence): ${said ?? '—'}`, at: new Date() })
    }
    const c = await SupportCase.create({ user: u.id, order: b.orderId?.toUpperCase() ?? null, subject: b.subject, source, priority, aiDecision: b.aiDecisionId ?? null, messages })
    await notifyStaff({ type: 'SUPPORT', title: `New support case${priority === 'HIGH' ? ' (high priority)' : ''}`, body: b.subject, link: `/admin/support/${c._id}`, dedupeKey: `case-new:${c._id}` })
    await notify({ userId: u.id, type: 'SUPPORT', title: 'We received your request', body: `"${b.subject}" — our team usually replies within one business day.`, link: `/support/${c._id}`, dedupeKey: `case-ack:${c._id}` })
    res.status(201).json(caseJson(c.toObject()))
  }),
)

supportRouter.get(
  '/api/support/cases',
  signedIn,
  handler(async (req, res) => {
    const u = requireUser(req)
    res.json((await SupportCase.find({ user: u.id }).sort({ updatedAt: -1 }).limit(100).lean()).map(caseJson))
  }),
)

supportRouter.get(
  '/api/support/cases/:id',
  signedIn,
  handler(async (req, res) => {
    const { c } = await loadCase(req)
    res.json(caseJson(c))
  }),
)

supportRouter.post(
  '/api/support/cases/:id/messages',
  signedIn,
  handler(async (req, res) => {
    const { u, c } = await loadCase(req)
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body)
    if (c.status === 'CLOSED') throw new ApiError(409, 'CASE_CLOSED', 'This case is closed — open a new one')
    const staff = isStaff(u)
    await SupportCase.updateOne(
      { _id: c._id },
      { $push: { messages: { from: staff ? 'AGENT' : 'USER', author: u.name, text, at: new Date() } }, ...(staff ? c.status === 'OPEN' && { status: 'IN_PROGRESS' } : c.status === 'RESOLVED' && { status: 'OPEN' }) },
    )
    if (staff) await notify({ userId: String(c.user), type: 'SUPPORT', title: `Reply on "${c.subject}"`, body: text.slice(0, 140), link: `/support/${c._id}`, email: true })
    else await notifyStaff({ type: 'SUPPORT', title: `Customer replied: ${c.subject}`, body: text.slice(0, 140), link: `/admin/support/${c._id}` })
    res.json(caseJson((await SupportCase.findById(c._id).lean())!))
  }),
)

// ------------------------------------------------------------------ staff

supportRouter.get(
  '/api/admin/support/cases',
  staffOnly,
  handler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const rows = await SupportCase.aggregate([
      { $match: status ? { status } : {} },
      { $set: { _p: { $indexOfArray: [['HIGH', 'NORMAL', 'LOW'], '$priority'] } } },
      { $sort: { _p: 1, updatedAt: -1 } },
      { $limit: 200 },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, email: 1, membershipTier: 1 } }] } },
    ])
    res.json(rows.map(caseJson))
  }),
)

supportRouter.patch(
  '/api/admin/support/cases/:id',
  staffOnly,
  handler(async (req, res) => {
    const { c } = await loadCase(req)
    const patch = parse(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional() }), req.body)
    await SupportCase.updateOne({ _id: c._id }, { $set: patch })
    if (patch.status === 'RESOLVED') await notify({ userId: String(c.user), type: 'SUPPORT', title: `Resolved: ${c.subject}`, body: 'Reply on the case if anything is still not right.', link: `/support/${c._id}`, dedupeKey: `case-resolved:${c._id}:${Date.now()}` })
    res.json(caseJson((await SupportCase.findById(c._id).lean())!))
  }),
)
