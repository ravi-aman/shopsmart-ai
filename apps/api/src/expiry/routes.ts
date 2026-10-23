import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { withTransaction } from '../db.js'
import { adminOnly, requirePartner, requireUser, staffOnly } from '../http/auth.js'
import { ApiError, handler, notFound, parse } from '../http/errors.js'
import { AdminAudit, ExpiryOffer, ExpiryRule, Inventory, InventoryBatch, Partner, StockMovement } from '../models/index.js'
import { notifyStaff } from '../notifications/service.js'
import { eligiblePartners, runExpiryJob } from './job.js'

export const expiryRouter = Router()

const DAY = 86_400_000

// ------------------------------------------------------------------ admin: batches, rules, job

expiryRouter.get(
  '/api/admin/expiry/batches',
  staffOnly,
  handler(async (req, res) => {
    const within = Math.min(60, Math.max(1, Number(req.query.withinDays ?? 7)))
    const now = Date.now()
    const rows = await InventoryBatch.aggregate([
      { $match: { expiresAt: { $lte: new Date(now + within * DAY) }, status: { $in: ['ACTIVE', 'DISCOUNTED', 'OFFERED', 'EXPIRED'] } } },
      { $sort: { expiresAt: 1 } },
      { $limit: 300 },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $project: { name: 1, price: 1, storage: 1, category: 1 } }] } },
      { $lookup: { from: 'expiryoffers', localField: '_id', foreignField: 'batch', as: 'offers', pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 1 }, { $lookup: { from: 'partners', localField: 'partner', foreignField: '_id', as: 'pt', pipeline: [{ $project: { name: 1 } }] } }] } },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          batchNo: 1,
          productId: '$product',
          productName: { $first: '$p.name' },
          price: { $first: '$p.price' },
          storage: { $first: '$p.storage' },
          warehouseId: '$warehouse',
          quantityAvailable: 1,
          expiresAt: 1,
          status: 1,
          discountPercent: 1,
          offer: { $let: { vars: { o: { $first: '$offers' } }, in: { $cond: [{ $ifNull: ['$$o', false] }, { id: { $toString: '$$o._id' }, status: '$$o.status', partner: { $first: '$$o.pt.name' }, distanceMeters: '$$o.distanceMeters', emailStatus: '$$o.email.status' }, null] } } },
        },
      },
    ])
    res.json(rows.map((r) => ({ ...r, daysLeft: Math.round(((new Date(r.expiresAt).getTime() - now) / DAY) * 10) / 10 })))
  }),
)

expiryRouter.get(
  '/api/admin/expiry/rules',
  staffOnly,
  handler(async (_req, res) => {
    res.json(await ExpiryRule.find().sort({ category: 1 }).lean())
  }),
)

const ruleSchema = z.object({
  category: z.string().min(1).max(60),
  tiers: z.array(z.object({ daysLeft: z.number().min(0).max(60), percent: z.number().min(1).max(90) })).min(1).max(6),
  offerToPartnersDaysLeft: z.number().min(0).max(30),
  active: z.boolean().default(true),
})

expiryRouter.put(
  '/api/admin/expiry/rules',
  adminOnly,
  handler(async (req, res) => {
    const rule = parse(ruleSchema, req.body)
    await ExpiryRule.updateOne({ category: rule.category }, { $set: rule }, { upsert: true })
    await AdminAudit.create({ actor: requireUser(req).email, action: 'EXPIRY_RULE_UPSERT', target: rule.category, details: rule })
    res.json(rule)
  }),
)

/** Runs the expiry job now (it also runs on a schedule); idempotent. */
expiryRouter.post(
  '/api/admin/expiry/run',
  staffOnly,
  handler(async (req, res) => {
    const r = await runExpiryJob()
    await AdminAudit.create({ actor: requireUser(req).email, action: 'EXPIRY_JOB_RUN', details: r })
    res.json(r)
  }),
)

expiryRouter.get(
  '/api/admin/expiry/offers',
  staffOnly,
  handler(async (_req, res) => {
    res.json(await offerRows({}))
  }),
)

// ------------------------------------------------------------------ admin: partners

const partnerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['NGO', 'COLD_STORAGE']),
  email: z.email(),
  phone: z.string().max(20).nullish(),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  address: z.string().max(200).default(''),
  supportedCategories: z.array(z.string().max(60)).min(1),
  storage: z.array(z.enum(['AMBIENT', 'CHILLED', 'FROZEN'])).min(1),
  capacityUnits: z.number().int().min(1).max(100000),
  verified: z.boolean().default(false),
  active: z.boolean().default(true),
})

const partnerJson = (p: Record<string, any>) => ({
  id: String(p._id),
  name: p.name,
  kind: p.kind,
  email: p.email,
  phone: p.phone,
  lng: p.location.coordinates[0],
  lat: p.location.coordinates[1],
  address: p.address,
  supportedCategories: p.supportedCategories,
  storage: p.storage,
  capacityUnits: p.capacityUnits,
  verified: p.verified,
  active: p.active,
  ...(p.distanceMeters != null && { distanceMeters: Math.round(p.distanceMeters) }),
})

expiryRouter.get(
  '/api/admin/partners',
  staffOnly,
  handler(async (_req, res) => {
    res.json((await Partner.find().sort({ name: 1 }).lean()).map(partnerJson))
  }),
)

/** Preview: which partners would get an offer from a centre for a category/storage type. */
expiryRouter.get(
  '/api/admin/partners/near',
  staffOnly,
  handler(async (req, res) => {
    const q = parse(z.object({ warehouse: z.string().regex(/^WH-[A-Z]{3}$/), category: z.string().default('fresh-pantry'), storage: z.enum(['AMBIENT', 'CHILLED', 'FROZEN']).default('CHILLED') }), req.query)
    res.json((await eligiblePartners(q.warehouse, q.category, q.storage)).map(partnerJson))
  }),
)

expiryRouter.post(
  '/api/admin/partners',
  adminOnly,
  handler(async (req, res) => {
    const p = parse(partnerSchema, req.body)
    const doc = await Partner.create({ ...p, location: { type: 'Point', coordinates: [p.lng, p.lat] } })
    await AdminAudit.create({ actor: requireUser(req).email, action: 'PARTNER_CREATE', target: String(doc._id), details: { name: p.name, verified: p.verified } })
    res.status(201).json(partnerJson(doc.toObject()))
  }),
)

expiryRouter.patch(
  '/api/admin/partners/:id',
  adminOnly,
  handler(async (req, res) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) throw notFound('Partner not found')
    const patch = parse(z.object({ verified: z.boolean().optional(), active: z.boolean().optional(), capacityUnits: z.number().int().min(0).optional() }), req.body)
    const doc = await Partner.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean()
    if (!doc) throw notFound('Partner not found')
    await AdminAudit.create({ actor: requireUser(req).email, action: 'PARTNER_UPDATE', target: id, details: patch })
    res.json(partnerJson(doc))
  }),
)

// ------------------------------------------------------------------ partner portal

async function offerRows(match: Record<string, unknown>) {
  const rows = await ExpiryOffer.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $limit: 200 },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $project: { name: 1, storage: 1, images: 1 } }] } },
    { $lookup: { from: 'inventorybatches', localField: 'batch', foreignField: '_id', as: 'b', pipeline: [{ $project: { batchNo: 1, expiresAt: 1 } }] } },
    { $lookup: { from: 'partners', localField: 'partner', foreignField: '_id', as: 'pt', pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: 'warehouses', localField: 'warehouse', foreignField: '_id', as: 'w', pipeline: [{ $project: { name: 1, city: 1 } }] } },
  ])
  return rows.map((o) => ({
    id: String(o._id),
    status: o.status,
    productId: o.product,
    productName: o.p[0]?.name,
    image: o.p[0]?.images?.[0] ?? null,
    storage: o.p[0]?.storage,
    batchNo: o.b[0]?.batchNo,
    bestBefore: o.b[0]?.expiresAt,
    quantity: o.quantity,
    transferredQuantity: o.transferredQuantity,
    partner: o.pt[0]?.name,
    pickupFrom: o.w[0] ? `${o.w[0].name}, ${o.w[0].city}` : o.warehouse,
    distanceMeters: o.distanceMeters,
    offerExpiresAt: o.offerExpiresAt,
    emailStatus: o.email?.status,
    history: o.history,
    createdAt: o.createdAt,
  }))
}

expiryRouter.get(
  '/api/partner/offers',
  handler(async (req, res) => {
    const u = requirePartner(req)
    res.json(await offerRows({ partner: new mongoose.Types.ObjectId(u.partnerId) }))
  }),
)

async function loadPartnerOffer(req: Parameters<typeof requirePartner>[0]) {
  const u = requirePartner(req)
  const id = String(req.params.id)
  if (!mongoose.isValidObjectId(id)) throw notFound('Offer not found')
  const offer = await ExpiryOffer.findOne({ _id: id, partner: u.partnerId }).lean() // partners only see their own offers
  if (!offer) throw notFound('Offer not found')
  return { u, offer }
}

expiryRouter.post(
  '/api/partner/offers/:id/accept',
  handler(async (req, res) => {
    const { u, offer } = await loadPartnerOffer(req)
    if (offer.offerExpiresAt < new Date()) throw new ApiError(409, 'OFFER_EXPIRED', 'This offer has expired')
    const r = await ExpiryOffer.updateOne({ _id: offer._id, status: 'OFFERED' }, { status: 'ACCEPTED', $push: { history: { status: 'ACCEPTED', at: new Date(), by: u.email } } })
    if (r.modifiedCount === 0) throw new ApiError(409, 'OFFER_NOT_OPEN', 'This offer is no longer open')
    await notifyStaff({ type: 'PARTNER_OFFER', title: 'Partner accepted a surplus offer', body: `${offer.quantity} units — arrange pickup.`, link: '/admin/expiry', dedupeKey: `accepted:${offer._id}` })
    res.json((await offerRows({ _id: offer._id }))[0])
  }),
)

expiryRouter.post(
  '/api/partner/offers/:id/reject',
  handler(async (req, res) => {
    const { u, offer } = await loadPartnerOffer(req)
    const r = await ExpiryOffer.updateOne({ _id: offer._id, status: 'OFFERED' }, { status: 'REJECTED', $push: { history: { status: 'REJECTED', at: new Date(), by: u.email } } })
    if (r.modifiedCount === 0) throw new ApiError(409, 'OFFER_NOT_OPEN', 'This offer is no longer open')
    // back on clearance sale; the next job run may offer it to the next-nearest partner
    await InventoryBatch.updateOne({ _id: offer.batch, status: 'OFFERED' }, { status: 'DISCOUNTED' })
    res.json((await offerRows({ _id: offer._id }))[0])
  }),
)

/** ACCEPTED → PICKED_UP → TRANSFERRED (with the quantity actually handed over). */
expiryRouter.patch(
  '/api/partner/offers/:id/status',
  handler(async (req, res) => {
    const { u, offer } = await loadPartnerOffer(req)
    const body = parse(z.object({ status: z.enum(['PICKED_UP', 'TRANSFERRED']), transferredQuantity: z.number().int().min(1).optional() }), req.body)
    const from = body.status === 'PICKED_UP' ? 'ACCEPTED' : 'PICKED_UP'
    if (offer.status !== from) throw new ApiError(409, 'INVALID_TRANSITION', `Offer must be ${from} to mark it ${body.status}`)
    if (body.status === 'PICKED_UP') {
      await ExpiryOffer.updateOne({ _id: offer._id, status: from }, { status: 'PICKED_UP', $push: { history: { status: 'PICKED_UP', at: new Date(), by: u.email } } })
    } else {
      const qty = Math.min(body.transferredQuantity ?? offer.quantity, offer.quantity)
      await withTransaction(async (session) => {
        const s = session ?? undefined
        const r = await ExpiryOffer.updateOne({ _id: offer._id, status: from }, { status: 'TRANSFERRED', transferredQuantity: qty, $push: { history: { status: 'TRANSFERRED', at: new Date(), by: u.email, note: `${qty} units` } } }, { session: s })
        if (r.modifiedCount === 0) throw new ApiError(409, 'INVALID_TRANSITION', 'Offer changed — refresh')
        const batch = await InventoryBatch.findById(offer.batch).session(s ?? null).lean()
        const take = Math.min(qty, batch?.quantityAvailable ?? 0)
        await InventoryBatch.updateOne({ _id: offer.batch }, [{ $set: { quantityAvailable: { $max: [0, { $subtract: ['$quantityAvailable', take] }] }, status: { $cond: [{ $lte: [{ $subtract: ['$quantityAvailable', take] }, 0] }, 'TRANSFERRED', 'DISCOUNTED'] } } }], { session: s, updatePipeline: true })
        await Inventory.updateOne({ product: offer.product, warehouse: offer.warehouse }, [{ $set: { onHand: { $max: [0, { $subtract: ['$onHand', take] }] } } }], { session: s, updatePipeline: true })
        await StockMovement.create([{ product: offer.product, warehouse: offer.warehouse, batch: offer.batch, delta: -take, reason: 'DONATION', actor: `partner:${u.partnerId}`, ref: String(offer._id) }], { session: s })
      })
    }
    res.json((await offerRows({ _id: offer._id }))[0])
  }),
)
