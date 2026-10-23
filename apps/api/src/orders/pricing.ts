import { Inventory, InventoryBatch, Product, Promotion, Warehouse } from '../models/index.js'
import { ApiError } from '../http/errors.js'
import { addDays, deliveryDays, round2, shippingFee, today } from './rules.js'

/**
 * The single pricing engine. Quotes, checkout and the AI checkout assistant all call it, so the
 * assistant can only ever explain numbers the backend computed.
 */
export interface Line {
  productId: string
  quantity: number
}

export interface PricedLine {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  lineSubtotal: number
  discount: number
  discountReasons: string[]
  allocations: { batch: string; quantity: number; discountPercent: number; expiresAt: Date }[]
}

export interface Quote {
  subtotal: number
  discount: number
  promotionCodes: string[]
  shippingFee: number
  total: number
  shippingExplanation: string
  shippingPolicy: { document: string; section: string; version: string | null }
  warehouseId: string
  warehouseCity: string
  promisedDate: string
  crossRegion: boolean
  itemCount: number
  lines: PricedLine[]
}

/** Batches that may be sold: not expired, recalled, transferred or held for a partner offer. */
export const SELLABLE_BATCH = { status: { $in: ['ACTIVE', 'DISCOUNTED'] as ('ACTIVE' | 'DISCOUNTED')[] }, quantityAvailable: { $gt: 0 } }

async function sellableBatches(productId: string, warehouseId: string) {
  return InventoryBatch.find({ product: productId, warehouse: warehouseId, ...SELLABLE_BATCH, expiresAt: { $gt: new Date() } }).sort({ expiresAt: 1 }).lean()
}

/** One fulfilment centre must hold every line: prefer the shopper's region, then the one with most stock. */
export async function chooseWarehouse(lines: Line[], region: string, perishable: Set<string>) {
  const warehouses = await Warehouse.find().lean()
  const candidates: { id: string; city: string; region: string; stock: number }[] = []
  for (const w of warehouses) {
    let ok = true
    let stock = 0
    for (const l of lines) {
      const inv = await Inventory.findOne({ product: l.productId, warehouse: w._id }).lean()
      const available = inv ? inv.onHand - inv.reserved : 0
      let sellable = available
      if (perishable.has(l.productId)) sellable = Math.min(available, (await sellableBatches(l.productId, w._id as string)).reduce((n, b) => n + b.quantityAvailable, 0))
      if (sellable < l.quantity) {
        ok = false
        break
      }
      stock += sellable
    }
    if (ok) candidates.push({ id: w._id as string, city: w.city, region: w.region, stock })
  }
  candidates.sort((a, b) => Number(b.region === region) - Number(a.region === region) || b.stock - a.stock)
  if (!candidates[0]) throw new ApiError(409, 'SPLIT_FULFILMENT', 'No single fulfilment centre has every item in stock. Remove an item or order it separately.')
  return candidates[0]
}

export async function priceLines(lines: Line[], tier: string, region: string, policyVersion: (doc: string) => Promise<string | null>): Promise<Quote> {
  if (!lines.length) throw new ApiError(409, 'EMPTY_CART', 'Your cart is empty')
  const products = new Map((await Product.find({ _id: { $in: lines.map((l) => l.productId) }, status: 'ACTIVE' }).lean()).map((p) => [p._id as string, p]))
  for (const l of lines) if (!products.has(l.productId)) throw new ApiError(409, 'PRODUCT_UNAVAILABLE', `Product ${l.productId} is no longer available`)
  const perishable = new Set(lines.filter((l) => products.get(l.productId)!.perishable).map((l) => l.productId))
  const wh = await chooseWarehouse(lines, region, perishable)

  const now = new Date()
  const promos = await Promotion.find({ status: 'ACTIVE', type: 'PERCENT', product: { $in: lines.map((l) => l.productId) }, startsAt: { $lte: now }, endsAt: { $gte: now } }).lean()
  const codes = new Set<string>()
  const priced: PricedLine[] = []
  for (const l of lines) {
    const p = products.get(l.productId)!
    const lineSubtotal = round2(p.price * l.quantity)
    const reasons: string[] = []
    let discount = 0
    const allocations: PricedLine['allocations'] = []
    // perishables: FEFO allocation, each unit discounted by its batch's clearance percent
    if (perishable.has(l.productId)) {
      let need = l.quantity
      for (const b of await sellableBatches(l.productId, wh.id)) {
        if (need <= 0) break
        const take = Math.min(need, b.quantityAvailable)
        allocations.push({ batch: String(b._id), quantity: take, discountPercent: b.discountPercent ?? 0, expiresAt: b.expiresAt })
        if (b.discountPercent) {
          discount += (p.price * take * b.discountPercent) / 100
          reasons.push(`${b.discountPercent}% clearance on ${take} unit${take > 1 ? 's' : ''} (best before ${b.expiresAt.toISOString().slice(0, 10)})`)
        }
        need -= take
      }
    }
    // the best active promotion applies to units not already on clearance (no stacking)
    const promo = promos.filter((x) => x.product === l.productId).sort((a, b) => b.value - a.value)[0]
    if (promo) {
      const clearanceUnits = allocations.filter((a) => a.discountPercent > 0).reduce((n, a) => n + a.quantity, 0)
      const units = l.quantity - clearanceUnits
      if (units > 0) {
        discount += (p.price * units * promo.value) / 100
        reasons.push(`${promo.value}% off with ${promo.code}`)
        codes.add(promo.code)
      }
    }
    priced.push({ productId: l.productId, name: p.name, quantity: l.quantity, unitPrice: p.price, lineSubtotal, discount: round2(discount), discountReasons: reasons, allocations })
  }
  const subtotal = round2(priced.reduce((n, l) => n + l.lineSubtotal, 0))
  const discount = round2(priced.reduce((n, l) => n + l.discount, 0))
  const fee = shippingFee(tier, subtotal - discount)
  return {
    subtotal,
    discount,
    promotionCodes: [...codes],
    shippingFee: fee.amount,
    total: round2(subtotal - discount + fee.amount),
    shippingExplanation: fee.explanation,
    shippingPolicy: { ...fee.source, version: await policyVersion(fee.source.document) },
    warehouseId: wh.id,
    warehouseCity: wh.city,
    promisedDate: addDays(today(), deliveryDays(region, wh.region)),
    crossRegion: region !== wh.region,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    lines: priced,
  }
}
