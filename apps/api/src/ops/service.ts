import mongoose from 'mongoose'
import { withTransaction } from '../db.js'
import { ApiError, notFound } from '../http/errors.js'
import { AiAudit, AiFeedback, ExpiryOffer, Inventory, InventoryBatch, Order, Product, Promotion, StockMovement, StockRequest, SupportCase, Warehouse } from '../models/index.js'
import { notify } from '../notifications/service.js'

const DAY = 86_400_000
export const VELOCITY_WINDOW_DAYS = 14
export const LEAD_TIME_DAYS = 7
const TARGET_COVER_DAYS = 30
const SURPLUS_COVER_DAYS = 45
const round1 = (n: number) => Math.round(n * 10) / 10
const today = () => new Date().toISOString().slice(0, 10)
const startOfToday = () => new Date(`${today()}T00:00:00.000Z`)

// ------------------------------------------------------------------ KPIs

export async function kpis() {
  const since24h = new Date(Date.now() - DAY)
  const since7d = new Date(Date.now() - 7 * DAY)
  const from14 = new Date(startOfToday().getTime() - 13 * DAY)
  const [orders] = await Order.aggregate([
    {
      $group: {
        _id: null,
        ordersToday: { $sum: { $cond: [{ $gte: ['$createdAt', startOfToday()] }, 1, 0] } },
        revenueToday: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', startOfToday()] }, { $ne: ['$status', 'CANCELLED'] }] }, '$total', 0] } },
        openOrders: { $sum: { $cond: [{ $in: ['$status', ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY']] }, 1, 0] } },
        returnsPending: { $sum: { $cond: [{ $eq: ['$status', 'RETURN_REQUESTED'] }, 1, 0] } },
        delayedShipments: { $sum: { $cond: [{ $and: [{ $eq: ['$shipment.delayed', true] }, { $in: ['$status', ['SHIPPED', 'OUT_FOR_DELIVERY']] }] }, 1, 0] } },
      },
    },
  ])
  const [ai] = await AiAudit.aggregate([
    { $match: { createdAt: { $gte: since24h } } },
    { $group: { _id: null, total: { $sum: 1 }, low: { $sum: { $cond: [{ $eq: ['$confidence', 'LOW'] }, 1, 0] } }, fallbacks: { $sum: { $cond: [{ $ne: ['$error', null] }, 1, 0] } }, latency: { $avg: '$latencyMs' }, cost: { $sum: '$estimatedCostUsd' }, tokens: { $sum: { $add: [{ $ifNull: ['$promptTokens', 0] }, { $ifNull: ['$completionTokens', 0] }] } } } },
  ])
  const aiByAgent = await AiAudit.aggregate([
    { $match: { createdAt: { $gte: since7d } } },
    { $group: { _id: '$agent', count: { $sum: 1 }, costUsd: { $sum: '$estimatedCostUsd' } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, agent: '$_id', count: 1, costUsd: { $round: ['$costUsd', 4] } } },
  ])
  const [votes] = await AiFeedback.aggregate([{ $group: { _id: null, helpful: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } }, total: { $sum: 1 } } }])
  const byDay = await Order.aggregate([
    { $match: { createdAt: { $gte: from14 } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $ne: ['$status', 'CANCELLED'] }, '$total', 0] } } } },
  ])
  const dayMap = new Map(byDay.map((d) => [d._id as string, d]))
  const ordersByDay = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(from14.getTime() + i * DAY).toISOString().slice(0, 10)
    const d = dayMap.get(day)
    return { day, orders: d?.orders ?? 0, revenue: Math.round((d?.revenue ?? 0) * 100) / 100 }
  })
  return {
    ordersToday: orders?.ordersToday ?? 0,
    revenueToday: Math.round((orders?.revenueToday ?? 0) * 100) / 100,
    openOrders: orders?.openOrders ?? 0,
    returnsPending: orders?.returnsPending ?? 0,
    delayedShipments: orders?.delayedShipments ?? 0,
    aiAnswers24h: ai?.total ?? 0,
    lowConfidence24h: ai?.low ?? 0,
    aiFallbacks24h: ai?.fallbacks ?? 0,
    aiAvgLatencyMs: Math.round(ai?.latency ?? 0),
    aiTokens24h: ai?.tokens ?? 0,
    aiCostUsd24h: Math.round((ai?.cost ?? 0) * 10000) / 10000,
    helpfulVotes: votes?.helpful ?? 0,
    totalVotes: votes?.total ?? 0,
    nearExpiryBatches: await InventoryBatch.countDocuments({ status: { $in: ['ACTIVE', 'DISCOUNTED', 'OFFERED'] }, quantityAvailable: { $gt: 0 }, expiresAt: { $lte: new Date(Date.now() + 3 * DAY) } }),
    openPartnerOffers: await ExpiryOffer.countDocuments({ status: { $in: ['OFFERED', 'ACCEPTED', 'PICKED_UP'] } }),
    openSupportCases: await SupportCase.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
    pendingRestockRequests: await StockRequest.countDocuments({ status: 'ACTIVE' }),
    ordersByDay,
    aiByAgent,
  }
}

// ------------------------------------------------------------------ fulfilment issues

export async function issues() {
  const twoDaysAgo = new Date(Date.now() - 2 * DAY)
  const rows = await Order.aggregate([
    {
      $match: {
        status: { $in: ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'] },
        $or: [{ 'shipment.delayed': true }, { status: { $in: ['PLACED', 'PACKED'] }, createdAt: { $lt: twoDaysAgo } }, { promisedDate: { $lt: today() } }],
      },
    },
    { $sort: { createdAt: 1 } },
    { $limit: 200 },
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, membershipTier: 1 } }] } },
  ])
  return rows.map((o) => {
    const tier = o.u[0]?.membershipTier ?? 'BASIC'
    return {
      orderId: o._id,
      status: o.status,
      customer: o.u[0]?.name,
      tier,
      carrier: o.shipment?.carrier,
      eta: o.shipment?.eta,
      promisedDate: o.promisedDate,
      lastEvent: o.shipment?.events?.at(-1)?.note ?? null,
      issue: o.shipment?.delayed ? 'DELAYED_IN_TRANSIT' : ['PLACED', 'PACKED'].includes(o.status) && o.createdAt < twoDaysAgo ? 'NOT_DISPATCHED' : 'PAST_PROMISED_DATE',
      suggestedAction: tier !== 'BASIC' ? 'Notify the customer; Prime/Premium late deliveries get a $5 Wallet credit (Delivery SLA by Region › Late Delivery Compensation).' : 'Notify the customer with the new ETA.',
    }
  })
}

// ------------------------------------------------------------------ forecast

export type Risk = 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OK' | 'OVERSTOCK'
const RISK_ORDER: Risk[] = ['OUT_OF_STOCK', 'CRITICAL', 'LOW', 'OK', 'OVERSTOCK']

export interface StockPosition {
  productId: string
  productName: string
  category: string
  warehouseId: string
  city: string
  available: number
  dailySales: number
  daysOfCover: number | null
  risk: Risk
}

export function riskOf(available: number, velocity: number, cover: number | null): Risk {
  if (velocity <= 0) return available > 60 ? 'OVERSTOCK' : 'OK'
  if (available === 0) return 'OUT_OF_STOCK'
  if (cover! < LEAD_TIME_DAYS) return 'CRITICAL'
  if (cover! < 2 * LEAD_TIME_DAYS) return 'LOW'
  if (cover! > 90 && available > 40) return 'OVERSTOCK'
  return 'OK'
}

export async function positions(productId?: string): Promise<StockPosition[]> {
  const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * DAY)
  const sales = await StockMovement.aggregate([{ $match: { reason: 'SALE', at: { $gte: since } } }, { $group: { _id: { p: '$product', w: '$warehouse' }, sold: { $sum: { $multiply: ['$delta', -1] } } } }])
  const sold = new Map(sales.map((s) => [`${s._id.p}|${s._id.w}`, s.sold as number]))
  const cities = new Map((await Warehouse.find().select('city').lean()).map((w) => [String(w._id), w.city]))
  const rows = await Inventory.aggregate([
    { $match: productId ? { product: productId.toUpperCase() } : {} },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $match: { status: 'ACTIVE' } }, { $project: { name: 1, categoryName: 1 } }] } },
    { $unwind: '$p' },
  ])
  return rows
    .map((i) => {
      const available = Math.max(0, i.onHand - (i.reserved ?? 0))
      const v = (sold.get(`${i.product}|${i.warehouse}`) ?? 0) / VELOCITY_WINDOW_DAYS
      const cover = v > 0 ? available / v : null
      return { productId: i.product, productName: i.p.name, category: i.p.categoryName, warehouseId: i.warehouse, city: cities.get(i.warehouse) ?? i.warehouse, available, dailySales: round1(v), daysOfCover: cover == null ? null : round1(cover), risk: riskOf(available, v, cover) }
    })
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.warehouseId.localeCompare(b.warehouseId))
}

const surplus = (p: StockPosition) => Math.max(0, p.available - Math.max(Math.ceil(p.dailySales * SURPLUS_COVER_DAYS), 5))

export interface Recommendation {
  type: 'TRANSFER' | 'REORDER'
  productId: string
  productName: string
  fromWarehouse: string | null
  toWarehouse: string
  quantity: number
  rationale: string
}

/** At-risk positions with a recommended transfer (from a centre with surplus) or reorder, most urgent first. */
export async function risks() {
  const all = await positions()
  const byProduct = new Map<string, StockPosition[]>()
  for (const p of all) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p])
  const out: { position: StockPosition; recommendation: Recommendation }[] = []
  for (const p of all) {
    if (!['OUT_OF_STOCK', 'CRITICAL', 'LOW'].includes(p.risk)) continue
    const needed = Math.ceil(p.dailySales * TARGET_COVER_DAYS) - p.available
    if (needed <= 0) continue
    const donor = byProduct
      .get(p.productId)!
      .filter((o) => o.warehouseId !== p.warehouseId && surplus(o) > 0)
      .sort((a, b) => surplus(b) - surplus(a))[0]
    const rec: Recommendation = donor
      ? {
          type: 'TRANSFER',
          productId: p.productId,
          productName: p.productName,
          fromWarehouse: donor.warehouseId,
          toWarehouse: p.warehouseId,
          quantity: Math.min(needed, surplus(donor)),
          rationale: `${donor.city} has ${donor.available} units (${donor.daysOfCover == null ? 'no recent sales' : `${donor.daysOfCover} days of cover`}); moving ${Math.min(needed, surplus(donor))} restores about ${TARGET_COVER_DAYS} days of cover in ${p.city}.`,
        }
      : { type: 'REORDER', productId: p.productId, productName: p.productName, fromWarehouse: null, toWarehouse: p.warehouseId, quantity: needed, rationale: `No centre has surplus; reorder ${needed} units from the supplier (lead time ${LEAD_TIME_DAYS} days).` }
    out.push({ position: p, recommendation: rec })
  }
  return out.sort((a, b) => RISK_ORDER.indexOf(a.position.risk) - RISK_ORDER.indexOf(b.position.risk) || b.position.dailySales - a.position.dailySales)
}

/** Lots of stock, slow sales, no promotion yet — candidates for a discount. */
export async function overstock(limit: number) {
  const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * DAY)
  const promoted = new Set((await Promotion.find({ status: { $in: ['DRAFT', 'ACTIVE'] }, product: { $ne: null } }).select('product').lean()).map((p) => p.product))
  const stock = await Inventory.aggregate([{ $group: { _id: '$product', available: { $sum: { $max: [{ $subtract: ['$onHand', '$reserved'] }, 0] } } } }, { $match: { available: { $gte: 80 } } }])
  const sales = new Map((await StockMovement.aggregate([{ $match: { reason: 'SALE', at: { $gte: since } } }, { $group: { _id: '$product', sold: { $sum: { $multiply: ['$delta', -1] } } } }])).map((s) => [s._id as string, s.sold / VELOCITY_WINDOW_DAYS]))
  const products = new Map((await Product.find({ _id: { $in: stock.map((s) => s._id) }, status: 'ACTIVE' }).select('name categoryName price').lean()).map((p) => [String(p._id), p]))
  return stock
    .filter((s) => products.has(s._id) && !promoted.has(s._id))
    .map((s) => ({ s, v: sales.get(s._id) ?? 0 }))
    .filter(({ s, v }) => v === 0 || s.available / v > 60)
    .sort((a, b) => b.s.available / Math.max(b.v, 0.1) - a.s.available / Math.max(a.v, 0.1))
    .slice(0, limit)
    .map(({ s, v }) => {
      const p = products.get(s._id)!
      return { productId: s._id as string, productName: p.name, category: p.categoryName, price: p.price, available: s.available as number, dailySales: round1(v), daysOfCover: v > 0 ? round1(s.available / v) : null }
    })
}

// ------------------------------------------------------------------ stock changes

/** Tells shoppers waiting on a product that it is back, once (requests flip ACTIVE → NOTIFIED). */
export async function notifyRestocked(productId: string) {
  const [inv] = await Inventory.aggregate([{ $match: { product: productId } }, { $group: { _id: null, a: { $sum: { $max: [{ $subtract: ['$onHand', '$reserved'] }, 0] } } } }])
  if (!inv || inv.a <= 0) return 0
  const product = await Product.findById(productId).select('name slug').lean()
  if (!product) return 0
  let n = 0
  for (const r of await StockRequest.find({ product: productId, status: 'ACTIVE' }).lean()) {
    const claimed = await StockRequest.updateOne({ _id: r._id, status: 'ACTIVE' }, { status: 'NOTIFIED', notifiedAt: new Date() })
    if (claimed.modifiedCount === 0) continue
    await notify({ userId: String(r.user), type: 'RESTOCK', title: `${product.name} is back in stock`, body: 'The item you asked about is available again — while stocks last.', link: `/p/${product.slug}`, dedupeKey: `restock:${r._id}`, email: true })
    n++
  }
  return n
}

export async function transfer(productId: string, from: string, to: string, quantity: number, actor: string) {
  if (from === to) throw new ApiError(400, 'INVALID_TRANSFER', 'Source and destination must differ')
  await withTransaction(async (session) => {
    const s = session ?? undefined
    const moved = await Inventory.updateOne({ product: productId, warehouse: from, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] } }, { $inc: { onHand: -quantity } }, { session: s })
    if (moved.modifiedCount === 0) throw new ApiError(409, 'INSUFFICIENT_STOCK', `${from} no longer has ${quantity} units to spare`)
    const landed = await Inventory.updateOne({ product: productId, warehouse: to }, { $inc: { onHand: quantity } }, { session: s })
    if (landed.matchedCount === 0) throw notFound(`No inventory record for ${productId} at ${to}`)
    await StockMovement.create(
      [
        { product: productId, warehouse: from, delta: -quantity, reason: 'TRANSFER_OUT', actor },
        { product: productId, warehouse: to, delta: quantity, reason: 'TRANSFER_IN', actor },
      ],
      { session: s, ordered: true },
    )
  })
  await notifyRestocked(productId)
  return { productId, from, to, quantity, approvedBy: actor }
}

/** Supplier delivery or stock count correction at one centre. */
export async function adjustStock(productId: string, warehouse: string, delta: number, reason: 'RESTOCK' | 'ADJUSTMENT', actor: string) {
  const r = await Inventory.updateOne({ product: productId, warehouse, ...(delta < 0 && { $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, -delta] } }) }, { $inc: { onHand: delta } })
  if (r.matchedCount === 0) throw delta < 0 ? new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough unreserved stock to remove') : notFound(`No inventory record for ${productId} at ${warehouse}`)
  await StockMovement.create({ product: productId, warehouse, delta, reason, actor })
  const notified = delta > 0 ? await notifyRestocked(productId) : 0
  return { productId, warehouse, delta, notified, position: (await positions(productId)).find((p) => p.warehouseId === warehouse) }
}

// ------------------------------------------------------------------ promotions

export async function promotions() {
  const rows = await Promotion.aggregate([{ $sort: { createdAt: -1 } }, { $limit: 200 }, { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $project: { name: 1 } }] } }])
  return rows.map((p) => ({ id: String(p._id), code: p.code, description: p.description, type: p.type, value: p.value, productId: p.product, productName: p.p[0]?.name ?? null, startsAt: p.startsAt, endsAt: p.endsAt, status: p.status, createdBy: p.createdBy, rationale: p.rationale }))
}

/** Saves a suggestion as a DRAFT; shoppers see nothing until a human activates it. */
export async function createDraft(productId: string, percent: number, days: number, rationale: string | null, createdBy: 'HUMAN' | 'AGENT') {
  const p = await Product.findById(productId.toUpperCase()).select('name').lean()
  if (!p) throw notFound(`Product ${productId} not found`)
  const code = `SAVE${Math.trunc(percent)}-${productId}`.toUpperCase()
  const doc = await Promotion.findOneAndUpdate(
    { code },
    { $set: { rationale }, $setOnInsert: { code, description: `${Math.trunc(percent)}% off ${p.name}`, type: 'PERCENT', value: percent, product: productId.toUpperCase(), startsAt: new Date(), endsAt: new Date(Date.now() + days * DAY), status: 'DRAFT', createdBy } },
    { upsert: true, new: true },
  ).lean()
  return String(doc!._id)
}

export async function setPromotionStatus(id: string, status: 'ACTIVE' | 'ENDED') {
  if (!mongoose.isValidObjectId(id)) throw notFound('Promotion not found')
  const r = await Promotion.updateOne({ _id: id }, { status })
  if (r.matchedCount === 0) throw notFound('Promotion not found')
}
