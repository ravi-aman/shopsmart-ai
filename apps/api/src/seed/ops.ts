import { logger } from '../logger.js'
import { Inventory, Order, Product, StockMovement, User, Warehouse } from '../models/index.js'
import { nextSequence } from '../models/index.js'

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % 100000
}

/**
 * 60 days of deterministic sales history so the stock-out forecast has real velocity. Sell-through is
 * proportional to stock (~1–3 months of cover); ~1 in 40 positions is a "hot" item selling 3–8 units
 * almost daily — those are the ones the forecast should flag. Empty positions mostly have no recent sales.
 */
export async function seedSalesHistory() {
  if (await StockMovement.exists({ reason: 'SALE' })) return
  const inv = await Inventory.find().lean()
  const docs: Record<string, unknown>[] = []
  const now = Date.now()
  for (const i of inv) {
    const key = i.product + i.warehouse
    const hot = hash(`${key}hot`) % 40 === 0
    const p = i.onHand === 0 ? (hash(`${key}sold-out`) % 10 === 0 ? 30 : 0) : hot ? 90 : Math.min(60, Math.max(2, Math.floor((i.onHand * (20 + (hash(`${key}k`) % 60))) / 120)))
    for (let d = 1; d <= 60; d++) {
      if (hash(key + d) % 100 >= p) continue
      const qty = hot ? 3 + (hash(`${key}${d}q`) % 6) : 1 + (hash(`${key}${d}q`) % 3)
      docs.push({ product: i.product, warehouse: i.warehouse, delta: -qty, reason: 'SALE', at: new Date(now - d * 86_400_000 + (hash(i.product + d) % 600) * 60_000) })
    }
  }
  await StockMovement.insertMany(docs, { ordered: false })
  logger.info({ movements: docs.length }, 'seeded 60 days of sales history')
  await seedOrderHistory()
}

/** Two weeks of delivered orders for the demo customers so dashboards and the order agent have history. */
async function seedOrderHistory() {
  if (await Order.exists({})) return
  const customers = await User.find({ role: 'CUSTOMER' }).sort({ email: 1 }).lean()
  const products = await Product.find({ status: 'ACTIVE' }).sort({ _id: 1 }).limit(200).lean()
  const warehouses = await Warehouse.find().sort({ _id: 1 }).lean()
  const orders: Record<string, unknown>[] = []
  for (let d = 1; d <= 13; d++) {
    const perDay = 1 + (hash(`${d}n`) % 6)
    for (let k = 1; k <= perDay; k++) {
      const u = customers[hash(`${d}${k}`) % customers.length]
      const p = products[hash(`${k}${d}p`) % products.length]
      const w = warehouses[hash(`${d}${k}w`) % warehouses.length]
      const id = `ORD-${await nextSequence('order')}`
      const created = new Date(Date.now() - d * 86_400_000)
      const delivered = new Date(created.getTime() + 2 * 86_400_000)
      orders.push({
        _id: id,
        user: u._id,
        status: 'DELIVERED',
        items: [{ product: p._id, name: p.name, slug: p.slug, image: p.images?.[0] ?? null, brand: p.brand, category: p.category, categoryName: p.categoryName, categoryPath: p.categoryPath, quantity: 1, unitPrice: p.price }],
        subtotal: p.price,
        total: p.price,
        address: { name: u.name, line1: '1 Demo Street', city: w.city, pincode: '400001', region: w.region, phone: '+91 90000 00000' },
        warehouse: w._id,
        promisedDate: delivered.toISOString().slice(0, 10),
        deliveredAt: delivered,
        createdAt: created,
        updatedAt: delivered,
        shipment: {
          id: `SHP-${id.slice(4)}`,
          carrier: 'Delhivery',
          trackingNo: `DE${id.slice(4)}`,
          eta: delivered.toISOString().slice(0, 10),
          events: [
            { status: 'PLACED', location: w.city, note: 'Order confirmed', at: created },
            { status: 'DELIVERED', location: w.city, note: 'Delivered to customer', at: delivered },
          ],
        },
      })
    }
  }
  await Order.insertMany(orders, { timestamps: false } as never)
  logger.info({ orders: orders.length }, 'seeded historical orders')
}
