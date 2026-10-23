import type { ClientSession } from 'mongoose'
import { withTransaction } from '../db.js'
import type { CurrentUser } from '../http/auth.js'
import { isStaff } from '../http/auth.js'
import { ApiError, notFound } from '../http/errors.js'
import { Cart, Inventory, InventoryBatch, nextSequence, Order, PolicyDocument, Product, StockMovement } from '../models/index.js'
import { events, notify } from '../notifications/service.js'
import { type Line, priceLines, type Quote } from './pricing.js'
import { notifyRestocked } from '../ops/service.js'
import { CANCELLABLE, cancelPolicyFor, returnWindow, today } from './rules.js'

export const FLOW = ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const
const CARRIERS = ['BlueDart', 'Delhivery', 'Ekart', 'XpressBees']

/** Resolves a policy rule to the active document version so citations are exact. */
export async function policyVersion(document: string) {
  return (await PolicyDocument.findOne({ title: document, active: true }).select('version').lean())?.version ?? null
}

export async function cartLines(userId: string): Promise<Line[]> {
  const cart = await Cart.findOne({ user: userId }).lean()
  return (cart?.items ?? []).map((i) => ({ productId: i.product, quantity: i.quantity }))
}

export const quote = async (user: CurrentUser, region: string): Promise<Quote> => priceLines(await cartLines(user.id), user.tier, region, policyVersion)

export interface Address {
  name: string
  line1: string
  city: string
  pincode: string
  region: string
  phone: string
}

/**
 * Re-prices the cart server-side, then reserves stock and writes the order in one transaction.
 * Every decrement is conditional (no overselling under concurrency); a failed condition aborts all.
 */
export async function checkout(user: CurrentUser, address: Address) {
  const lines = await cartLines(user.id)
  const q = await priceLines(lines, user.tier, address.region, policyVersion)
  const products = new Map((await Product.find({ _id: { $in: lines.map((l) => l.productId) } }).lean()).map((p) => [p._id as string, p]))
  const orderId = `ORD-${await nextSequence('order')}`
  const n = Number(orderId.slice(4))

  await withTransaction(async (session: ClientSession | null) => {
    const s = session ?? undefined
    for (const line of q.lines) {
      const r = await Inventory.updateOne(
        { product: line.productId, warehouse: q.warehouseId, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, line.quantity] } },
        { $inc: { onHand: -line.quantity } },
        { session: s },
      )
      if (r.modifiedCount === 0) throw new ApiError(409, 'INSUFFICIENT_STOCK', `${line.name} just went out of stock. Please review your cart.`)
      for (const a of line.allocations) {
        const b = await InventoryBatch.updateOne({ _id: a.batch, quantityAvailable: { $gte: a.quantity }, status: { $in: ['ACTIVE', 'DISCOUNTED'] } }, { $inc: { quantityAvailable: -a.quantity } }, { session: s })
        if (b.modifiedCount === 0) throw new ApiError(409, 'INSUFFICIENT_STOCK', `${line.name} just went out of stock. Please review your cart.`)
      }
      await StockMovement.create([{ product: line.productId, warehouse: q.warehouseId, delta: -line.quantity, reason: 'SALE', actor: `user:${user.id}`, ref: orderId }], { session: s })
    }
    const carrier = CARRIERS[n % CARRIERS.length]
    await Order.create(
      [
        {
          _id: orderId,
          user: user.id,
          status: 'PLACED',
          items: q.lines.map((l) => {
            const p = products.get(l.productId)!
            return { product: p._id, name: p.name, slug: p.slug, image: p.images?.[0] ?? null, brand: p.brand, category: p.category, categoryName: p.categoryName, categoryPath: p.categoryPath, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, allocations: l.allocations.map((a) => ({ batch: a.batch, quantity: a.quantity, discountPercent: a.discountPercent })) }
          }),
          subtotal: q.subtotal,
          discount: q.discount,
          promotionCodes: q.promotionCodes,
          shippingFee: q.shippingFee,
          total: q.total,
          address,
          warehouse: q.warehouseId,
          promisedDate: q.promisedDate,
          shipment: { id: `SHP-${n}`, carrier, trackingNo: `${carrier.slice(0, 2).toUpperCase()}${7_000_000_000 + n * 7919}`, eta: q.promisedDate, events: [{ status: 'PLACED', location: q.warehouseCity, note: 'Order confirmed', at: new Date() }] },
        },
      ],
      { session: s },
    )
    await Cart.updateOne({ user: user.id }, { $set: { items: [] } }, { session: s })
  })
  await notify({ userId: user.id, type: 'ORDER_STATUS', title: `Order ${orderId} confirmed`, body: `Arriving by ${q.promisedDate}. Total $${q.total.toFixed(2)}.`, link: `/orders/${orderId}`, dedupeKey: `order:${orderId}:PLACED`, email: true })
  return detail(orderId, user)
}

// ------------------------------------------------------------------ read

export async function list(userId: string) {
  const orders = await Order.find({ user: userId }).sort({ createdAt: -1 }).lean()
  return orders.map((o) => {
    const first = [...o.items].sort((a, b) => (b.unitPrice ?? 0) - (a.unitPrice ?? 0))[0]
    return { id: o._id, status: o.status, total: o.total, currency: o.currency, itemCount: o.items.reduce((n, i) => n + (i.quantity ?? 0), 0), firstItemName: first?.name, firstItemImage: first?.image ?? null, promisedDate: o.promisedDate, createdAt: (o as unknown as { createdAt: Date }).createdAt }
  })
}

/** Latest unfinished order, else the latest order — what "my order" usually means. */
export async function currentOrderId(userId: string) {
  const open = await Order.findOne({ user: userId, status: { $in: ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'RETURN_REQUESTED'] } }).sort({ createdAt: -1 }).select('_id').lean()
  if (open) return open._id as string
  return ((await Order.findOne({ user: userId }).sort({ createdAt: -1 }).select('_id').lean())?._id as string | undefined) ?? null
}

async function loadOwned(orderId: string, user: CurrentUser | null) {
  const o = await Order.findById(orderId.toUpperCase()).lean()
  // ownership check: customers see only their own orders; staff see all
  if (!o || (user && !isStaff(user) && String(o.user) !== user.id)) throw notFound(`Order ${orderId} not found`)
  return o
}

export async function detail(orderId: string, user: CurrentUser | null) {
  const o = await loadOwned(orderId, user)
  const requested = new Map(o.returns.map((r) => [r.product, r.status]))
  const items = await Promise.all(
    o.items.map(async (i) => {
      const window = returnWindow(i.categoryPath ?? '')
      const policy = { ...window.source, version: await policyVersion(window.source.document) }
      const existing = requested.get(i.product ?? '')
      let returnInfo
      if (existing) returnInfo = { eligible: false, deadline: null, reason: `Return ${existing.toLowerCase()}`, policy, requestStatus: existing }
      else if (o.status === 'CANCELLED') returnInfo = { eligible: false, deadline: null, reason: 'This order was cancelled, so there is nothing to return', policy, requestStatus: null }
      else if (!o.deliveredAt || !['DELIVERED', 'RETURN_REQUESTED'].includes(o.status)) returnInfo = { eligible: false, deadline: null, reason: 'Returns open after delivery', policy, requestStatus: null }
      else if (window.days === 0) returnInfo = { eligible: false, deadline: null, reason: 'This item is not returnable', policy, requestStatus: null }
      else {
        const d = new Date(o.deliveredAt)
        d.setUTCDate(d.getUTCDate() + window.days)
        const deadline = d.toISOString().slice(0, 10)
        const open = today() <= deadline
        returnInfo = { eligible: open, deadline, reason: open ? `Returnable until ${deadline} (${window.days}-day window)` : `Return window closed on ${deadline}`, policy, requestStatus: null }
      }
      return { productId: i.product, name: i.name, slug: i.slug, image: i.image, brand: i.brand, category: i.categoryName, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount ?? 0, returnInfo }
    }),
  )
  const canCancel = CANCELLABLE.has(o.status)
  const cancelRef = cancelPolicyFor(o.status)
  const cancelReason = canCancel
    ? 'Not shipped yet — you can cancel free of charge.'
    : o.status === 'SHIPPED'
      ? "Already shipped — it can't be cancelled. You can refuse the delivery or return it after it arrives."
      : o.status === 'OUT_FOR_DELIVERY'
        ? "Out for delivery — it can't be cancelled. Refuse the delivery or return it instead."
        : o.status === 'CANCELLED'
          ? 'This order is already cancelled.'
          : "Delivered orders can't be cancelled — request a return instead."
  const wh = o.warehouse
  return {
    id: String(o._id),
    status: o.status,
    subtotal: o.subtotal,
    discount: o.discount,
    shippingFee: o.shippingFee,
    total: o.total,
    currency: o.currency,
    paymentStatus: o.paymentStatus,
    address: o.address,
    warehouseId: wh,
    warehouseCity: o.shipment?.events?.[0]?.location ?? wh,
    promisedDate: o.promisedDate,
    createdAt: (o as unknown as { createdAt: Date }).createdAt,
    deliveredAt: o.deliveredAt,
    items,
    shipment: o.shipment ? { id: o.shipment.id, carrier: o.shipment.carrier, trackingNo: o.shipment.trackingNo, eta: o.shipment.eta, delayed: o.shipment.delayed, events: o.shipment.events } : null,
    cancel: { allowed: canCancel, reason: cancelReason, policy: { ...cancelRef, version: await policyVersion(cancelRef.document) } },
  }
}

export type OrderDetail = Awaited<ReturnType<typeof detail>>

// ------------------------------------------------------------------ actions

async function pushEvent(orderId: string, status: string, location: string, note: string, extra: Record<string, unknown> = {}) {
  await Order.updateOne({ _id: orderId }, { $push: { 'shipment.events': { status, location, note, at: new Date() } }, ...extra })
  events.emit(`order:${orderId}`, { status, location, note, at: new Date() })
}

export async function cancel(orderId: string, user: CurrentUser) {
  const o = await detail(orderId, user)
  if (!o.cancel.allowed) throw new ApiError(409, 'CANNOT_CANCEL', o.cancel.reason)
  const raw = await Order.findById(o.id).lean()
  await withTransaction(async (session) => {
    const s = session ?? undefined
    const r = await Order.updateOne({ _id: o.id, status: { $in: [...CANCELLABLE] as never[] } }, { status: 'CANCELLED', cancelledAt: new Date(), paymentStatus: 'REFUND_PENDING' }, { session: s })
    if (r.modifiedCount === 0) throw new ApiError(409, 'CANNOT_CANCEL', 'The order changed status — please refresh')
    for (const i of raw!.items) {
      await Inventory.updateOne({ product: i.product, warehouse: raw!.warehouse }, { $inc: { onHand: i.quantity ?? 0 } }, { session: s })
      for (const a of i.allocations ?? []) await InventoryBatch.updateOne({ _id: a.batch, status: { $in: ['ACTIVE', 'DISCOUNTED'] } }, { $inc: { quantityAvailable: a.quantity } }, { session: s })
      await StockMovement.create([{ product: i.product ?? '', warehouse: raw!.warehouse ?? '', delta: i.quantity ?? 0, reason: 'CANCELLATION' as const, actor: `user:${user.id}`, ref: o.id }], { session: s })
    }
  })
  for (const i of raw!.items) if (i.product) await notifyRestocked(i.product)
  await pushEvent(o.id, 'CANCELLED', o.warehouseCity ?? '', 'Cancelled by customer; refund initiated')
  await notify({ userId: String(raw!.user), type: 'ORDER_STATUS', title: `Order ${o.id} cancelled`, body: 'Your refund has been initiated (see the Refund Policy for timelines).', link: `/orders/${o.id}`, dedupeKey: `order:${o.id}:CANCELLED`, email: true })
  return detail(o.id, user)
}

export async function requestReturn(orderId: string, user: CurrentUser, productId: string, reason: string) {
  const o = await detail(orderId, user)
  const item = o.items.find((i) => i.productId?.toUpperCase() === productId.toUpperCase())
  if (!item) throw notFound(`That item is not in order ${o.id}`)
  if (!item.returnInfo.eligible) throw new ApiError(409, 'NOT_RETURNABLE', item.returnInfo.reason)
  await Order.updateOne(
    { _id: o.id, 'returns.product': { $ne: item.productId } },
    { $push: { returns: { product: item.productId, reason: reason.trim(), status: 'REQUESTED', policy: { ...item.returnInfo.policy, deadline: item.returnInfo.deadline }, createdAt: new Date() } } },
  )
  const fresh = await Order.findById(o.id).lean()
  if (fresh && fresh.returns.length >= fresh.items.length) await Order.updateOne({ _id: o.id }, { status: 'RETURN_REQUESTED' })
  await pushEvent(o.id, 'RETURN_REQUESTED', o.address?.city ?? '', `Return requested for ${item.name}`)
  await notify({ userId: user.id, type: 'RETURN_STATUS', title: `Return requested for ${item.name}`, body: 'We will schedule a pickup. Refunds start after the quality check.', link: `/orders/${o.id}`, dedupeKey: `return:${o.id}:${item.productId}` })
  return detail(o.id, user)
}

/** Moves an order one step along the delivery flow (simulator and admin "advance"). */
export async function advance(orderId: string) {
  const o = await Order.findById(orderId.toUpperCase()).lean()
  if (!o) throw notFound(`Order ${orderId} not found`)
  const idx = FLOW.indexOf(o.status as (typeof FLOW)[number])
  if (idx < 0 || idx === FLOW.length - 1) return null
  const next = FLOW[idx + 1]
  const r = await Order.updateOne({ _id: o._id, status: o.status }, { status: next, ...(next === 'DELIVERED' ? { deliveredAt: new Date() } : {}) })
  if (r.modifiedCount === 0) return null // someone else advanced it first
  const whCity = o.shipment?.events?.[0]?.location ?? o.warehouse ?? ''
  const custCity = o.address?.city ?? ''
  if (next === 'PACKED') await pushEvent(o._id as string, next, whCity, 'Packed at fulfilment centre')
  if (next === 'SHIPPED') {
    await pushEvent(o._id as string, next, whCity, 'Handed to carrier')
    // deterministic ~1 in 4 orders hit a hub delay, so ops has issues to work on
    let h = 0
    for (const c of o._id as string) h = (h * 31 + c.charCodeAt(0)) | 0
    if (Math.abs(h) % 4 === 0) {
      const eta = new Date(`${o.shipment?.eta ?? o.promisedDate}T00:00:00Z`)
      eta.setUTCDate(eta.getUTCDate() + 2)
      await pushEvent(o._id as string, 'DELAYED', 'Regional sorting hub', 'Delayed at sorting hub — expected +2 days', { $set: { 'shipment.delayed': true, 'shipment.eta': eta.toISOString().slice(0, 10) } })
    }
  }
  if (next === 'OUT_FOR_DELIVERY') await pushEvent(o._id as string, next, custCity, 'Out for delivery with courier')
  if (next === 'DELIVERED') await pushEvent(o._id as string, next, custCity, 'Delivered to customer')
  const titles: Record<string, string> = { PACKED: 'packed', SHIPPED: 'shipped', OUT_FOR_DELIVERY: 'out for delivery', DELIVERED: 'delivered' }
  await notify({ userId: String(o.user), type: 'ORDER_STATUS', title: `Order ${o._id} ${titles[next]}`, body: `Your order is now ${titles[next]}.`, link: `/orders/${o._id}`, dedupeKey: `order:${o._id}:${next}`, email: next === 'SHIPPED' || next === 'DELIVERED' })
  return next
}

export async function ordersDueForAdvance(minAgeSeconds: number) {
  const cutoff = new Date(Date.now() - minAgeSeconds * 1000)
  const open = await Order.find({ status: { $in: ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'] } }).select('_id shipment.events').lean()
  return open.filter((o) => (o.shipment?.events?.at(-1)?.at ?? new Date(0)) < cutoff).map((o) => o._id as string)
}
