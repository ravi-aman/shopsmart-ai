import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { Category, ExpiryRule, Inventory, InventoryBatch, Partner, Product, User, Warehouse } from '../models/index.js'

interface CatalogSeed {
  categories: { slug: string; name: string; parent: string | null; sortOrder: number }[]
  brands: string[]
  warehouses: { id: string; name: string; city: string; region: string }[]
  products: { id: string; name: string; slug: string; brand: string; category: string; description: string; price: number; mrp?: number; rating: number; ratingCount: number; images: string[]; specs: Record<string, unknown>; tags: string[] }[]
  inventory: { productId: string; warehouseId: string; onHand: number; reorderPoint: number }[]
}

/** [lng, lat] of each fulfilment centre — used for partner geo-search. */
const WAREHOUSE_COORDS: Record<string, [number, number]> = {
  'WH-MUM': [72.8777, 19.076],
  'WH-DEL': [77.0266, 28.4595],
  'WH-BLR': [77.5946, 12.9716],
  'WH-KOL': [88.3639, 22.5726],
  'WH-HYD': [78.4867, 17.385],
}

/** email, name, role, tier, region */
const DEMO_USERS: [string, string, string, string, string][] = [
  ['basic@shopsmart.dev', 'Aarav Basic', 'CUSTOMER', 'BASIC', 'IN-WEST'],
  ['prime@shopsmart.dev', 'Priya Prime', 'CUSTOMER', 'PRIME', 'IN-SOUTH'],
  ['premium@shopsmart.dev', 'Kabir Premium', 'CUSTOMER', 'PREMIUM', 'IN-NORTH'],
  ['admin@shopsmart.dev', 'Asha Admin', 'ADMIN', 'PREMIUM', 'IN-WEST'],
  ['ops@shopsmart.dev', 'Omar Ops', 'OPS', 'BASIC', 'IN-WEST'],
]

/** Grocery items that spoil, and how they must be stored. */
const STORAGE_BY_KEYWORD: [RegExp, 'CHILLED' | 'FROZEN'][] = [
  [/beef|chicken|fish|ice cream/i, 'FROZEN'],
  [/milk|eggs|juice|apple|kiwi|lemon|mulberry|strawberry|cucumber|pepper|chili|potato|onion/i, 'CHILLED'],
]

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % 10000
}

/** Offsets in metres → approximate [lng, lat]. */
const offset = ([lng, lat]: [number, number], northM: number, eastM: number): [number, number] => [
  lng + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)),
  lat + northM / 110_540,
]

/** Loads seed/catalog.json, demo users, expiry batches, partners and rules into an empty database. */
export async function seedCatalog(seedDir: string) {
  if ((await Product.estimatedDocumentCount()) > 0) return
  const c: CatalogSeed = JSON.parse(readFileSync(path.join(seedDir, 'catalog.json'), 'utf8'))

  const paths = new Map<string, string>()
  const names = new Map<string, string>()
  for (const cat of c.categories) {
    const p = cat.parent ? `${paths.get(cat.parent)}/${cat.slug}` : cat.slug
    paths.set(cat.slug, p)
    names.set(cat.slug, cat.name)
  }
  await Category.insertMany(c.categories.map((cat) => ({ _id: cat.slug, name: cat.name, parent: cat.parent, path: paths.get(cat.slug), sortOrder: cat.sortOrder })))
  await Warehouse.insertMany(c.warehouses.map((w) => ({ _id: w.id, name: w.name, city: w.city, region: w.region, location: { type: 'Point', coordinates: WAREHOUSE_COORDS[w.id] } })))

  const perishable = new Map<string, 'AMBIENT' | 'CHILLED' | 'FROZEN'>()
  await Product.insertMany(
    c.products.map((p) => {
      const storage = p.category === 'fresh-pantry' ? (STORAGE_BY_KEYWORD.find(([rx]) => rx.test(p.name))?.[1] ?? null) : null
      if (storage) perishable.set(p.id, storage)
      return {
        _id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        category: p.category,
        categoryName: names.get(p.category),
        categoryPath: paths.get(p.category),
        description: p.description,
        price: p.price,
        mrp: p.mrp ?? null,
        rating: p.rating,
        ratingCount: p.ratingCount,
        images: p.images,
        specs: p.specs,
        tags: p.tags,
        perishable: !!storage,
        storage: storage ?? 'AMBIENT',
        sizeChart: sizeChartFor(p),
      }
    }),
  )
  await Inventory.insertMany(c.inventory.map((i) => ({ product: i.productId, warehouse: i.warehouseId, onHand: i.onHand, reorderPoint: i.reorderPoint })))

  // Perishable stock is split into dated batches whose quantities add up to on-hand stock.
  const now = Date.now()
  const batches = c.inventory
    .filter((i) => perishable.has(i.productId) && i.onHand > 0)
    .flatMap((i) => {
      const h = hash(i.productId + i.warehouseId)
      const firstQty = i.onHand > 6 ? Math.ceil(i.onHand * 0.4) : i.onHand
      const lots = [{ qty: firstQty, days: 1 + (h % 6) }]
      if (i.onHand > firstQty) lots.push({ qty: i.onHand - firstQty, days: 8 + (h % 12) })
      return lots.map((lot, n) => ({
        product: i.productId,
        warehouse: i.warehouseId,
        batchNo: `${i.productId}-${i.warehouseId.slice(3)}-${n + 1}`,
        quantityReceived: lot.qty,
        quantityAvailable: lot.qty,
        expiresAt: new Date(now + lot.days * 86_400_000 - (h % 8) * 3_600_000),
      }))
    })
  await InventoryBatch.insertMany(batches)

  await ExpiryRule.insertMany([
    { category: '*', tiers: [{ daysLeft: 5, percent: 15 }, { daysLeft: 3, percent: 30 }, { daysLeft: 1, percent: 50 }], offerToPartnersDaysLeft: 1 },
    { category: 'fresh-pantry', tiers: [{ daysLeft: 4, percent: 20 }, { daysLeft: 2, percent: 35 }, { daysLeft: 1, percent: 50 }], offerToPartnersDaysLeft: 1 },
  ])

  // Two verified partners within 3 km of each centre, one unverified nearby, one verified but too far.
  const partners = Object.entries(WAREHOUSE_COORDS).flatMap(([wh, coord]) => {
    const city = c.warehouses.find((w) => w.id === wh)!.city
    return [
      { name: `${city} Food Bank`, kind: 'NGO', email: `foodbank.${wh.slice(3).toLowerCase()}@partners.shopsmart.dev`, location: { type: 'Point', coordinates: offset(coord, 1200, 800) }, address: `Near ${city} centre`, supportedCategories: ['fresh-pantry', 'groceries'], storage: ['AMBIENT', 'CHILLED'], capacityUnits: 120, verified: true },
      { name: `${city} Cold Chain Hub`, kind: 'COLD_STORAGE', email: `coldchain.${wh.slice(3).toLowerCase()}@partners.shopsmart.dev`, location: { type: 'Point', coordinates: offset(coord, -1800, 1500) }, address: `${city} industrial area`, supportedCategories: ['fresh-pantry', 'groceries'], storage: ['CHILLED', 'FROZEN'], capacityUnits: 400, verified: true },
      { name: `${city} Community Kitchen`, kind: 'NGO', email: `kitchen.${wh.slice(3).toLowerCase()}@partners.shopsmart.dev`, location: { type: 'Point', coordinates: offset(coord, 600, -900) }, supportedCategories: ['fresh-pantry'], storage: ['AMBIENT'], capacityUnits: 60, verified: false },
      { name: `${city} Outskirts Shelter`, kind: 'NGO', email: `shelter.${wh.slice(3).toLowerCase()}@partners.shopsmart.dev`, location: { type: 'Point', coordinates: offset(coord, 6500, 4000) }, supportedCategories: ['fresh-pantry', 'groceries'], storage: ['AMBIENT', 'CHILLED'], capacityUnits: 80, verified: true },
    ]
  })
  const created = await Partner.insertMany(partners)

  const pwd = await bcrypt.hash(config.DEMO_USER_PASSWORD, 10)
  await User.insertMany(DEMO_USERS.map(([email, name, role, tier, region]) => ({ email, name, passwordHash: pwd, role, membershipTier: tier, region, premiumUntil: tier === 'BASIC' ? null : new Date(now + 365 * 86_400_000) })))
  const mumbaiFoodBank = created.find((p) => p.name === 'Mumbai Food Bank')!
  await User.create({ email: 'partner@shopsmart.dev', name: 'Mumbai Food Bank', passwordHash: pwd, role: 'PARTNER', region: 'IN-WEST', partner: mumbaiFoodBank._id })

  logger.info({ products: c.products.length, batches: batches.length, partners: partners.length }, 'seeded catalogue, batches, partners and demo users')
}

/** Simple manufacturer size charts for clothing and footwear (centimetres). */
function sizeChartFor(p: { category: string }) {
  if (p.category === 'mens-clothing' || p.category === 'womens-clothing') {
    return { S: { chestCm: [86, 91], waistCm: [71, 76] }, M: { chestCm: [96, 101], waistCm: [81, 86] }, L: { chestCm: [106, 111], waistCm: [91, 96] }, XL: { chestCm: [116, 121], waistCm: [101, 106] } }
  }
  if (p.category === 'footwear') {
    return { '7': { footLengthCm: [25.0, 25.4] }, '8': { footLengthCm: [25.8, 26.2] }, '9': { footLengthCm: [26.7, 27.1] }, '10': { footLengthCm: [27.5, 27.9] }, '11': { footLengthCm: [28.4, 28.8] } }
  }
  return null
}
