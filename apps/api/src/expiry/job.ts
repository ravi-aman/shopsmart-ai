import { config } from '../config.js'
import { logger } from '../logger.js'
import { Category, ExpiryOffer, ExpiryRule, Inventory, InventoryBatch, Partner, Product, StockMovement, User, Warehouse, Wishlist } from '../models/index.js'
import { notify, notifyStaff, sendEmail } from '../notifications/service.js'

const DAY = 86_400_000

export interface ExpiryRunResult {
  expired: number
  discounted: number
  offered: number
  offersExpired: number
}

/** The rule for a product: its own category, its top-level department, else the '*' default. */
async function ruleFor(category: string, cache: Map<string, Awaited<ReturnType<typeof loadRules>>[number] | null>) {
  if (cache.has(category)) return cache.get(category)!
  const rules = await loadRules()
  const cat = await Category.findById(category).lean()
  const top = cat?.path.split('/')[0]
  const rule = rules.find((r) => r.category === category) ?? rules.find((r) => r.category === top) ?? rules.find((r) => r.category === '*') ?? null
  cache.set(category, rule)
  return rule
}
const loadRules = () => ExpiryRule.find({ active: true }).lean()

/** Highest discount tier whose threshold the batch has reached (tiers: [{daysLeft:5,percent:15},…]). */
export function applicableTier(tiers: { daysLeft?: number | null; percent?: number | null }[], daysLeft: number) {
  return tiers
    .filter((t) => t.daysLeft != null && t.percent != null && daysLeft <= t.daysLeft)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0] as { daysLeft: number; percent: number } | undefined
}

/**
 * Idempotent expiry worker:
 * 1. blocks expired batches (removes them from stock, never sells them);
 * 2. raises clearance discounts by tier — only ever upward, so re-runs change nothing;
 * 3. offers batches about to expire to the nearest verified partner within the radius;
 * 4. expires partner offers nobody answered, returning the batch to sale.
 */
export async function runExpiryJob(now = new Date()): Promise<ExpiryRunResult> {
  const result: ExpiryRunResult = { expired: 0, discounted: 0, offered: 0, offersExpired: 0 }

  // 1. expired → blocked
  const expired = await InventoryBatch.find({ status: { $in: ['ACTIVE', 'DISCOUNTED', 'OFFERED'] }, expiresAt: { $lte: now } }).lean()
  for (const b of expired) {
    const r = await InventoryBatch.updateOne({ _id: b._id, status: b.status }, { status: 'EXPIRED', quantityAvailable: 0 })
    if (r.modifiedCount === 0) continue
    if (b.quantityAvailable > 0) {
      await Inventory.updateOne({ product: b.product, warehouse: b.warehouse }, [{ $set: { onHand: { $max: [0, { $subtract: ['$onHand', b.quantityAvailable] }] } } }], { updatePipeline: true })
      await StockMovement.create({ product: b.product, warehouse: b.warehouse, batch: b._id, delta: -b.quantityAvailable, reason: 'EXPIRED', actor: 'expiry-job', ref: b.batchNo })
    }
    await ExpiryOffer.updateMany({ batch: b._id, status: { $in: ['OFFERED', 'ACCEPTED'] } }, { status: 'EXPIRED', $push: { history: { status: 'EXPIRED', at: now, by: 'expiry-job', note: 'Batch expired' } } })
    await notifyStaff({ type: 'ADMIN_WARNING', title: `Batch ${b.batchNo} expired`, body: `${b.quantityAvailable} units removed from sale at ${b.warehouse}.`, link: '/admin/expiry', dedupeKey: `expired:${b._id}` })
    result.expired++
  }

  // 4. unanswered partner offers lapse; the batch goes back on clearance sale
  const lapsed = await ExpiryOffer.find({ status: 'OFFERED', offerExpiresAt: { $lte: now } }).lean()
  for (const o of lapsed) {
    await ExpiryOffer.updateOne({ _id: o._id, status: 'OFFERED' }, { status: 'EXPIRED', $push: { history: { status: 'EXPIRED', at: now, by: 'expiry-job', note: 'No response before the deadline' } } })
    await InventoryBatch.updateOne({ _id: o.batch, status: 'OFFERED' }, { status: 'DISCOUNTED' })
    result.offersExpired++
  }

  // 2 & 3. discounts and partner offers for live batches
  const cache = new Map()
  const live = await InventoryBatch.find({ status: { $in: ['ACTIVE', 'DISCOUNTED'] }, quantityAvailable: { $gt: 0 }, expiresAt: { $gt: now } }).lean()
  for (const b of live) {
    const product = await Product.findById(b.product).lean()
    if (!product) continue
    const rule = await ruleFor(product.category, cache)
    if (!rule) continue
    const daysLeft = (b.expiresAt.getTime() - now.getTime()) / DAY

    const tier = applicableTier(rule.tiers, daysLeft)
    if (tier && tier.percent > (b.discountPercent ?? 0)) {
      // conditional update: only raises the discount, so concurrent or repeated runs are no-ops
      const r = await InventoryBatch.updateOne(
        { _id: b._id, discountPercent: { $lt: tier.percent } },
        { status: 'DISCOUNTED', discountPercent: tier.percent, discountTierDays: tier.daysLeft, $push: { discountHistory: { percent: tier.percent, at: now, reason: `≤${tier.daysLeft} days to expiry` } } },
      )
      if (r.modifiedCount > 0) {
        result.discounted++
        await notifyStaff({ type: 'NEAR_EXPIRY', title: `${product.name}: ${tier.percent}% clearance`, body: `Batch ${b.batchNo} (${b.quantityAvailable} units at ${b.warehouse}) expires ${b.expiresAt.toISOString().slice(0, 10)}.`, link: '/admin/expiry', dedupeKey: `discount:${b._id}:${tier.percent}` })
        for (const w of await Wishlist.find({ product: product._id }).lean()) {
          await notify({ userId: String(w.user), type: 'DISCOUNT', title: `${product.name} is ${tier.percent}% off`, body: `A batch near its best-before date is on clearance while stock lasts.`, link: `/p/${product.slug}`, dedupeKey: `wish-discount:${b._id}:${tier.percent}:${w.user}` })
        }
      }
    }

    if (daysLeft <= (rule.offerToPartnersDaysLeft ?? 1)) {
      if (await offerToPartner(b._id.toString(), { _id: String(product._id), name: product.name, category: product.category, storage: product.storage }, now)) result.offered++
    }
  }
  return result
}

/** Verified, active partners within the radius that accept this category and storage type, nearest first. */
export async function eligiblePartners(warehouseId: string, category: string, storage: string, radiusMeters = config.PARTNER_RADIUS_METERS) {
  const wh = await Warehouse.findById(warehouseId).lean()
  if (!wh) return []
  const cat = await Category.findById(category).lean()
  const cats = [category, cat?.path.split('/')[0]].filter(Boolean) as string[]
  return Partner.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: wh.location.coordinates as [number, number] },
        distanceField: 'distanceMeters',
        maxDistance: radiusMeters,
        spherical: true,
        query: { verified: true, active: true, supportedCategories: { $in: cats }, storage: storage, capacityUnits: { $gt: 0 } },
      },
    },
    { $limit: 10 },
  ])
}

async function offerToPartner(batchId: string, product: { _id: string; name: string; category: string; storage?: string | null }, now: Date) {
  const batch = await InventoryBatch.findById(batchId).lean()
  if (!batch || !['ACTIVE', 'DISCOUNTED'].includes(batch.status) || batch.quantityAvailable <= 0) return false
  if (await ExpiryOffer.exists({ batch: batch._id, status: { $in: ['OFFERED', 'ACCEPTED', 'PICKED_UP'] } })) return false
  const tried = new Set((await ExpiryOffer.find({ batch: batch._id }).select('partner').lean()).map((o) => String(o.partner)))
  const partners = (await eligiblePartners(batch.warehouse, product.category, product.storage ?? 'AMBIENT')).filter((p) => !tried.has(String(p._id)))
  const partner = partners[0]
  if (!partner) {
    await notifyStaff({ type: 'NEAR_EXPIRY', title: `No partner nearby for ${product.name}`, body: `Batch ${batch.batchNo} expires soon and no verified partner within ${config.PARTNER_RADIUS_METERS / 1000} km can take it.`, link: '/admin/expiry', dedupeKey: `no-partner:${batch._id}` })
    return false
  }
  // hold the batch for the partner (it leaves the shelf) — conditional so only one offer wins
  const held = await InventoryBatch.updateOne({ _id: batch._id, status: { $in: ['ACTIVE', 'DISCOUNTED'] } }, { status: 'OFFERED' })
  if (held.modifiedCount === 0) return false
  let offer
  try {
    offer = await ExpiryOffer.create({
      batch: batch._id,
      product: product._id,
      warehouse: batch.warehouse,
      partner: partner._id,
      quantity: Math.min(batch.quantityAvailable, partner.capacityUnits),
      distanceMeters: Math.round(partner.distanceMeters),
      offerExpiresAt: new Date(Math.min(now.getTime() + config.PARTNER_OFFER_HOURS * 3_600_000, batch.expiresAt.getTime())),
      history: [{ status: 'OFFERED', at: now, by: 'expiry-job' }],
    })
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false
    throw e
  }
  const email = await sendEmail(
    partner.email,
    `ShopSmart surplus offer: ${offer.quantity} × ${product.name}`,
    `Hello ${partner.name},\n\n${offer.quantity} units of ${product.name} (batch ${batch.batchNo}, best before ${batch.expiresAt.toISOString().slice(0, 10)}) are available for pickup ${(offer.distanceMeters / 1000).toFixed(1)} km away at our ${batch.warehouse} centre.\nPlease accept or reject before ${offer.offerExpiresAt.toISOString()} in the partner portal: ${config.CLIENT_URL}/partner\n\nShopSmart`,
  )
  await ExpiryOffer.updateOne({ _id: offer._id }, { email: { status: email.status, at: new Date(), error: email.error } })
  for (const u of await User.find({ role: 'PARTNER', partner: partner._id }).select('_id').lean()) {
    await notify({ userId: String(u._id), type: 'PARTNER_OFFER', title: `New offer: ${offer.quantity} × ${product.name}`, body: `Respond before ${offer.offerExpiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, link: '/partner', dedupeKey: `offer:${offer._id}` })
  }
  logger.info({ batch: batch.batchNo, partner: partner.name, distanceM: offer.distanceMeters }, 'partner offer created')
  return true
}
