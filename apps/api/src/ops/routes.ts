import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { listAudit, markApproved } from '../ai/audit.js'
import { checkRateLimit } from '../ai/rate-limit.js'
import { adminOnly, requireUser, signedIn, staffOnly } from '../http/auth.js'
import { ApiError, handler, notFound, parse } from '../http/errors.js'
import { AdminAudit, Inventory, Product, StockRequest } from '../models/index.js'
import { askOps } from './agent.js'
import * as ops from './service.js'

export const opsRouter = Router()

const WH = z.string().regex(/^WH-[A-Z]{3}$/)
const PRODUCT = z.string().trim().min(1).max(20).transform((s) => s.toUpperCase())
const objectId = z.string().regex(/^[a-f0-9]{24}$/)

opsRouter.get('/api/ops/kpis', staffOnly, handler(async (_req, res) => void res.json(await ops.kpis())))
opsRouter.get('/api/ops/forecast', staffOnly, handler(async (_req, res) => void res.json(await ops.risks())))
opsRouter.get('/api/ops/issues', staffOnly, handler(async (_req, res) => void res.json(await ops.issues())))
opsRouter.get('/api/ops/overstock', staffOnly, handler(async (_req, res) => void res.json(await ops.overstock(10))))
opsRouter.get(
  '/api/ops/inventory',
  staffOnly,
  handler(async (req, res) => {
    res.json(await ops.positions(typeof req.query.productId === 'string' ? req.query.productId : undefined))
  }),
)

opsRouter.post(
  '/api/ops/agent',
  staffOnly,
  handler(async (req, res) => {
    const { question } = parse(z.object({ question: z.string().trim().min(1).max(500) }), req.body)
    await checkRateLimit(req, 'ops:')
    res.json(await askOps(question, requireUser(req)))
  }),
)

/** Human approval of a transfer (possibly proposed by the ops agent; its audit entry is marked approved). */
opsRouter.post(
  '/api/ops/transfers',
  staffOnly,
  handler(async (req, res) => {
    const b = parse(z.object({ productId: PRODUCT, fromWarehouse: WH, toWarehouse: WH, quantity: z.number().int().min(1).max(1000), auditId: objectId.nullish() }), req.body)
    const u = requireUser(req)
    const r = await ops.transfer(b.productId, b.fromWarehouse, b.toWarehouse, b.quantity, u.email)
    await markApproved(b.auditId)
    await AdminAudit.create({ actor: u.email, action: 'STOCK_TRANSFER', target: b.productId, details: { ...b, fromAgent: !!b.auditId } })
    res.json(r)
  }),
)

opsRouter.get('/api/ops/promotions', staffOnly, handler(async (_req, res) => void res.json(await ops.promotions())))

opsRouter.post(
  '/api/ops/promotions',
  staffOnly,
  handler(async (req, res) => {
    const b = parse(z.object({ productId: PRODUCT, discountPercent: z.number().min(1).max(50), days: z.number().int().min(1).max(60).default(14), rationale: z.string().max(500).nullish(), fromAgent: z.boolean().default(false), auditId: objectId.nullish() }), req.body)
    const id = await ops.createDraft(b.productId, b.discountPercent, b.days, b.rationale ?? null, b.fromAgent ? 'AGENT' : 'HUMAN')
    await markApproved(b.auditId)
    await AdminAudit.create({ actor: requireUser(req).email, action: 'PROMOTION_DRAFT', target: id, details: b })
    res.json({ id, status: 'DRAFT' })
  }),
)

for (const [action, status] of [
  ['activate', 'ACTIVE'],
  ['end', 'ENDED'],
] as const) {
  opsRouter.post(
    `/api/ops/promotions/:id/${action}`,
    staffOnly,
    handler(async (req, res) => {
      const id = String(req.params.id)
      await ops.setPromotionStatus(id, status)
      await AdminAudit.create({ actor: requireUser(req).email, action: `PROMOTION_${status}`, target: id })
      res.json({ id, status })
    }),
  )
}

opsRouter.get(
  '/api/ops/audit',
  staffOnly,
  handler(async (req, res) => {
    const q = req.query
    const limit = Math.max(1, Math.min(Number(q.limit ?? 100) || 100, 500))
    res.json(await listAudit(typeof q.agent === 'string' ? q.agent : null, typeof q.confidence === 'string' ? q.confidence : null, q.fallbacksOnly === 'true', limit))
  }),
)

opsRouter.get(
  '/api/admin/audit',
  adminOnly,
  handler(async (_req, res) => {
    res.json(await AdminAudit.find().sort({ createdAt: -1 }).limit(200).lean())
  }),
)

// ------------------------------------------------------------------ admin: stock and products

/** Supplier delivery (positive) or count correction; a restock notifies shoppers waiting for the product. */
opsRouter.post(
  '/api/admin/inventory/adjust',
  staffOnly,
  handler(async (req, res) => {
    const b = parse(z.object({ productId: PRODUCT, warehouseId: WH, delta: z.number().int().min(-1000).max(5000).refine((n) => n !== 0, 'must not be 0'), reason: z.enum(['RESTOCK', 'ADJUSTMENT']).default('RESTOCK'), note: z.string().max(200).nullish() }), req.body)
    const u = requireUser(req)
    const r = await ops.adjustStock(b.productId, b.warehouseId, b.delta, b.reason, u.email)
    await AdminAudit.create({ actor: u.email, action: `STOCK_${b.reason}`, target: b.productId, details: b })
    res.json(r)
  }),
)

opsRouter.patch(
  '/api/admin/products/:id',
  adminOnly,
  handler(async (req, res) => {
    const id = String(req.params.id).toUpperCase()
    const patch = parse(z.object({ price: z.number().positive().max(100000).optional(), mrp: z.number().positive().max(100000).nullish(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).refine((p) => Object.keys(p).length > 0, 'nothing to update'), req.body)
    const before = await Product.findById(id).select('price mrp status').lean()
    if (!before) throw notFound(`Product ${id} not found`)
    await Product.updateOne({ _id: id }, { $set: patch })
    await AdminAudit.create({ actor: requireUser(req).email, action: 'PRODUCT_UPDATE', target: id, details: { before: { price: before.price, mrp: before.mrp, status: before.status }, after: patch } })
    res.json({ id, ...patch })
  }),
)

// ------------------------------------------------------------------ restock requests ("notify me")

opsRouter.post(
  '/api/products/:id/stock-requests',
  signedIn,
  handler(async (req, res) => {
    const id = String(req.params.id).toUpperCase()
    const u = requireUser(req)
    if (!(await Product.exists({ _id: id, status: 'ACTIVE' }))) throw notFound(`Product ${id} not found`)
    const [inv] = await Inventory.aggregate([{ $match: { product: id } }, { $group: { _id: null, a: { $sum: { $max: [{ $subtract: ['$onHand', '$reserved'] }, 0] } } } }])
    if ((inv?.a ?? 0) > 0) throw new ApiError(409, 'IN_STOCK', 'This product is in stock — you can order it now')
    const existing = await StockRequest.findOne({ user: u.id, product: id, status: 'ACTIVE' }).lean()
    const doc = existing ?? (await StockRequest.create({ user: u.id, product: id })).toObject()
    res.status(existing ? 200 : 201).json({ id: String(doc._id), productId: id, status: doc.status, createdAt: doc.createdAt })
  }),
)

opsRouter.get(
  '/api/me/stock-requests',
  signedIn,
  handler(async (req, res) => {
    const rows = await StockRequest.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(requireUser(req).id), status: { $ne: 'CANCELLED' } } },
      { $sort: { createdAt: -1 } },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $project: { name: 1, slug: 1, images: 1, price: 1 } }] } },
    ])
    res.json(rows.map((r) => ({ id: String(r._id), productId: r.product, productName: r.p[0]?.name, slug: r.p[0]?.slug, image: r.p[0]?.images?.[0] ?? null, price: r.p[0]?.price, status: r.status, createdAt: r.createdAt, notifiedAt: r.notifiedAt })))
  }),
)

opsRouter.delete(
  '/api/products/:id/stock-requests',
  signedIn,
  handler(async (req, res) => {
    await StockRequest.updateOne({ user: requireUser(req).id, product: String(req.params.id).toUpperCase(), status: 'ACTIVE' }, { status: 'CANCELLED' })
    res.status(204).end()
  }),
)
