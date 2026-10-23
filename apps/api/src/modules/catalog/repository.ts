import type { PipelineStage } from 'mongoose'
import { capabilities } from '../../db.js'
import { notFound } from '../../http/errors.js'
import { Category, Inventory, Product, Promotion } from '../../models/index.js'

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
const LOW_STOCK_THRESHOLD = 10

export const availabilityOf = (available: number): Availability =>
  available <= 0 ? 'OUT_OF_STOCK' : available <= LOW_STOCK_THRESHOLD ? 'LOW_STOCK' : 'IN_STOCK'

export interface ProductSummary {
  id: string
  slug: string
  name: string
  brand: string
  categorySlug: string
  categoryName: string
  price: number
  mrp: number | null
  currency: string
  rating: number
  ratingCount: number
  image: string | null
  specs: Record<string, unknown>
  availability: Availability
  availableQuantity: number
}

/** Spec keys exposed as filters, in display order. */
export const SPEC_FACETS: Record<string, string> = {
  ramGb: 'RAM (GB)',
  storageGb: 'Storage (GB)',
  displayInches: 'Screen size (in)',
  os: 'Operating system',
  formFactor: 'Type',
  format: 'Format',
  energyRating: 'Energy rating',
}

/** Joins live stock (on hand − reserved, summed over centres) as `available`. */
export const availabilityStages: PipelineStage[] = [
  {
    $lookup: {
      from: 'inventories',
      localField: '_id',
      foreignField: 'product',
      as: '_inv',
      pipeline: [{ $project: { _id: 0, a: { $max: [{ $subtract: ['$onHand', '$reserved'] }, 0] } } }],
    },
  },
  { $set: { available: { $sum: '$_inv.a' } } },
  { $unset: ['_inv', 'embedding'] },
]

export function toSummary(p: Record<string, any>): ProductSummary {
  const available = Number(p.available ?? 0)
  return {
    id: p._id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    categorySlug: p.category,
    categoryName: p.categoryName,
    price: p.price,
    mrp: p.mrp ?? null,
    currency: p.currency ?? 'USD',
    rating: p.rating,
    ratingCount: p.ratingCount,
    image: p.images?.[0] ?? null,
    specs: p.specs ?? {},
    availability: availabilityOf(available),
    availableQuantity: available,
  }
}

export type Sort = 'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'NEWEST'

export interface ProductQuery {
  q: string | null
  category: string | null
  brands: string[]
  minPrice: number | null
  maxPrice: number | null
  minRating: number | null
  inStockOnly: boolean
  specFilters: Record<string, string[]>
  sort: Sort
  page: number
  size: number
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function categoryPath(slug: string): Promise<string | undefined> {
  return (await Category.findById(slug).lean())?.path
}

/** Spec values arrive as strings; stored specs may be numbers or strings. */
const specValues = (values: string[]) => values.flatMap((v) => (v !== '' && !Number.isNaN(Number(v)) ? [v, Number(v)] : [v]))

/**
 * Leading stages that select products for a query. Text relevance comes from Atlas Search (fuzzy,
 * typo-tolerant) when available, else the weighted $text index, else a word-prefix regex.
 */
async function selectStages(q: ProductQuery, includeRefinements: boolean): Promise<{ stages: PipelineStage[]; scored: boolean }> {
  const match: Record<string, unknown> = { status: 'ACTIVE' }
  if (q.category) {
    const path = await categoryPath(q.category)
    if (!path) throw notFound(`Category '${q.category}' not found`)
    match.categoryPath = { $regex: `^${escapeRegex(path)}(/|$)` }
  }
  if (includeRefinements) {
    if (q.brands.length) match.brand = { $in: q.brands }
    if (q.minPrice != null || q.maxPrice != null) match.price = { ...(q.minPrice != null && { $gte: q.minPrice }), ...(q.maxPrice != null && { $lte: q.maxPrice }) }
    if (q.minRating != null) match.rating = { $gte: q.minRating }
    for (const [key, values] of Object.entries(q.specFilters)) {
      if (key in SPEC_FACETS && values.length) match[`specs.${key}`] = { $in: specValues(values) }
    }
  }

  const stages: PipelineStage[] = []
  let scored = false
  if (q.q) {
    const text = q.q.trim()
    if (capabilities.atlasSearch) {
      stages.push({
        $search: {
          index: 'products_search',
          compound: {
            should: [
              { text: { query: text, path: 'name', fuzzy: { maxEdits: 1, prefixLength: 1 }, score: { boost: { value: 5 } } } },
              { text: { query: text, path: 'brand', fuzzy: { maxEdits: 1 }, score: { boost: { value: 3 } } } },
              { text: { query: text, path: ['tags', 'description'] } },
            ],
            minimumShouldMatch: 1,
          },
        },
      } as PipelineStage)
      stages.push({ $set: { _score: { $meta: 'searchScore' } } })
      scored = true
    } else {
      match.$text = { $search: text }
      scored = true
    }
  }
  stages.push({ $match: match })
  if (scored && !capabilities.atlasSearch) stages.push({ $set: { _score: { $meta: 'textScore' } } })
  stages.push(...availabilityStages)
  if (includeRefinements && q.inStockOnly) stages.push({ $match: { available: { $gt: 0 } } })
  return { stages, scored }
}

function sortStage(q: ProductQuery, scored: boolean): PipelineStage {
  switch (q.sort) {
    case 'PRICE_ASC':
      return { $sort: { price: 1, _id: 1 } }
    case 'PRICE_DESC':
      return { $sort: { price: -1, _id: 1 } }
    case 'RATING':
      return { $sort: { rating: -1, ratingCount: -1, _id: 1 } }
    case 'NEWEST':
      return { $sort: { createdAt: -1, _id: 1 } }
    default:
      return scored ? { $sort: { _score: -1, ratingCount: -1, _id: 1 } } : { $sort: { _inStock: -1, _pop: -1, _id: 1 } }
  }
}

/** When the text index finds nothing (typos, partial words), retry with a word-prefix match on name, brand and category. */
async function withPrefixFallback(q: ProductQuery, includeRefinements: boolean) {
  const first = await selectStages(q, includeRefinements)
  if (!q.q || capabilities.atlasSearch) return first
  const probe = await Product.aggregate([...first.stages.slice(0, 1), { $limit: 1 }])
  if (probe.length) return first
  const words = q.q.trim().split(/\s+/).filter((w) => w.length >= 2).map(escapeRegex)
  if (!words.length) return first
  const rx = { $regex: `(^|\\s)(${words.join('|')})`, $options: 'i' }
  const noText = await selectStages({ ...q, q: null }, includeRefinements)
  const [matchStage, ...rest] = noText.stages
  const m = (matchStage as { $match: Record<string, unknown> }).$match
  return { stages: [{ $match: { ...m, $or: [{ name: rx }, { brand: rx }, { categoryName: rx }, { tags: rx }] } }, ...rest] as PipelineStage[], scored: false }
}

export async function searchWithCount(q: ProductQuery): Promise<{ items: ProductSummary[]; total: number }> {
  const { stages, scored } = await withPrefixFallback(q, true)
  const [res] = await Product.aggregate([
    ...stages,
    { $set: { _inStock: { $cond: [{ $gt: ['$available', 0] }, 1, 0] }, _pop: { $multiply: ['$rating', { $ln: { $add: ['$ratingCount', 1] } }] } } },
    { $facet: { items: [sortStage(q, scored), { $skip: q.page * q.size }, { $limit: q.size }], total: [{ $count: 'n' }] } } as PipelineStage,
  ])
  return { items: (res?.items ?? []).map(toSummary), total: res?.total?.[0]?.n ?? 0 }
}

export interface FacetValue {
  value: string
  label: string
  count: number
}
export interface Facet {
  key: string
  label: string
  values: FacetValue[]
}

const compareFacet = (a: string, b: string) => {
  const na = Number(a)
  const nb = Number(b)
  return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b, undefined, { sensitivity: 'base' }) : na - nb
}

/** Facets use only the text query and category, so selecting a brand doesn't hide the other brands. */
export async function facetsAndPrice(q: ProductQuery): Promise<{ facets: Facet[]; price: { min: number | null; max: number | null } }> {
  const { stages } = await withPrefixFallback(q, false)
  const specFacets = Object.fromEntries(
    Object.keys(SPEC_FACETS).map((k) => [k, [{ $match: { [`specs.${k}`]: { $ne: null } } }, { $group: { _id: { $toString: `$specs.${k}` }, n: { $sum: 1 } } }]]),
  )
  const [r] = await Product.aggregate([
    ...stages,
    {
      $facet: {
        category: [{ $group: { _id: '$category', name: { $first: '$categoryName' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        brand: [{ $group: { _id: '$brand', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 40 }],
        inStock: [{ $match: { available: { $gt: 0 } } }, { $count: 'n' }],
        price: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
        ...specFacets,
      },
    },
  ])
  const facets: Facet[] = []
  if (r.category.length > 1) facets.push({ key: 'category', label: 'Category', values: r.category.map((c: any) => ({ value: c._id, label: c.name, count: c.n })) })
  if (r.brand.length) facets.push({ key: 'brand', label: 'Brand', values: r.brand.map((b: any) => ({ value: b._id, label: b._id, count: b.n })) })
  for (const [key, label] of Object.entries(SPEC_FACETS)) {
    const values: FacetValue[] = (r[key] ?? []).map((v: any) => ({ value: v._id, label: v._id, count: v.n }))
    if (values.length < 2) continue
    values.sort((a, b) => compareFacet(a.value, b.value))
    facets.push({ key: `spec.${key}`, label, values })
  }
  facets.push({ key: 'availability', label: 'Availability', values: [{ value: 'IN_STOCK', label: 'In stock only', count: r.inStock[0]?.n ?? 0 }] })
  return { facets, price: { min: r.price[0]?.min ?? null, max: r.price[0]?.max ?? null } }
}

export async function suggest(q: string) {
  const rx = escapeRegex(q)
  const categories = await Category.find({ name: { $regex: `(^|\\s)${rx}`, $options: 'i' } })
    .sort({ name: 1 })
    .limit(3)
    .lean()
  const products = await Product.find({
    status: 'ACTIVE',
    $or: [{ name: { $regex: `(^|\\s)${rx}`, $options: 'i' } }, { brand: { $regex: `^${rx}`, $options: 'i' } }],
  })
    .select('name slug brand ratingCount')
    .sort({ ratingCount: -1 })
    .limit(20)
    .lean()
  const lower = q.toLowerCase()
  products.sort((a, b) => Number(b.name.toLowerCase().startsWith(lower) || b.brand.toLowerCase().startsWith(lower)) - Number(a.name.toLowerCase().startsWith(lower) || a.brand.toLowerCase().startsWith(lower)))
  return [
    ...categories.map((c) => ({ type: 'category' as const, label: c.name, slug: c._id as string })),
    ...products.slice(0, 7).map((p) => ({ type: 'product' as const, label: p.name, slug: p.slug })),
  ]
}

export async function findByIds(ids: string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return []
  const rows = await Product.aggregate([{ $match: { _id: { $in: ids.map((i) => i.toUpperCase()) }, status: 'ACTIVE' } }, ...availabilityStages])
  return rows.map(toSummary)
}

export async function findByIdOrSlug(key: string) {
  const [p] = await Product.aggregate([{ $match: { status: 'ACTIVE', $or: [{ _id: key.toUpperCase() }, { slug: key }] } }, ...availabilityStages])
  if (!p) return undefined
  return { summary: toSummary(p), description: p.description as string, images: (p.images ?? []) as string[], tags: (p.tags ?? []) as string[], categoryPath: p.categoryPath as string, category: p.category as string, sizeChart: p.sizeChart ?? null }
}

export async function related(productId: string, category: string, price: number, limit: number) {
  const rows = await Product.aggregate([
    { $match: { status: 'ACTIVE', category, _id: { $ne: productId } } },
    { $set: { _d: { $abs: { $subtract: ['$price', price] } } } },
    { $sort: { _d: 1, rating: -1 } },
    { $limit: limit },
    ...availabilityStages,
  ])
  return rows.map(toSummary)
}

export async function stockByWarehouse(productId: string) {
  const rows = await Inventory.aggregate([
    { $match: { product: productId } },
    { $lookup: { from: 'warehouses', localField: 'warehouse', foreignField: '_id', as: 'w' } },
    { $unwind: '$w' },
    { $project: { _id: 0, warehouseId: '$warehouse', city: '$w.city', region: '$w.region', available: { $max: [{ $subtract: ['$onHand', '$reserved'] }, 0] } } },
    { $sort: { city: 1 } },
  ])
  return rows as { warehouseId: string; city: string; region: string; available: number }[]
}

export async function breadcrumbs(path: string) {
  const slugs = path.split('/')
  const names = new Map((await Category.find({ _id: { $in: slugs } }).lean()).map((c) => [c._id as string, c.name]))
  return slugs.map((slug) => ({ slug, name: names.get(slug) ?? slug }))
}

export async function activePromotion(productId: string) {
  const now = new Date()
  const p = await Promotion.findOne({ product: productId, status: 'ACTIVE', type: 'PERCENT', startsAt: { $lte: now }, endsAt: { $gte: now } }).sort({ value: -1 }).lean()
  return p ? { code: p.code, description: p.description, percent: p.value, endsAt: p.endsAt } : null
}

export async function categoryTree() {
  const cats = await Category.find().sort({ sortOrder: 1 }).lean()
  const counts = new Map((await Product.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$category', n: { $sum: 1 } } }])).map((r) => [r._id, r.n as number]))
  interface Node {
    id: string
    slug: string
    name: string
    path: string
    productCount: number
    children: Node[]
  }
  const build = (parent: string | null): Node[] =>
    cats
      .filter((c) => (c.parent ?? null) === parent)
      .map((c) => {
        const children = build(c._id as string)
        return { id: c._id as string, slug: c._id as string, name: c.name, path: c.path, productCount: (counts.get(c._id) ?? 0) + children.reduce((n, x) => n + x.productCount, 0), children }
      })
  return build(null)
}
