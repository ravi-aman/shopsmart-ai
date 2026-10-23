import { Router } from 'express'
import { badRequest, handler, notFound } from '../../http/errors.js'
import * as repo from './repository.js'

const MAX_PAGE_SIZE = 60
const MAX_COMPARE = 4

export const catalogRouter = Router()

catalogRouter.get(
  '/api/catalog/categories',
  handler(async (_req, res) => {
    res.json(await repo.categoryTree())
  }),
)

/** Accepts repeated params and comma-separated values: ?brand=a&brand=b or ?brand=a,b */
export function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  return values.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean)
}

export function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v == null || String(v).trim() === '' ? undefined : String(v).trim()
}

function num(value: unknown, name: string): number | null {
  const v = first(value)
  if (v === undefined) return null
  const n = Number(v)
  if (Number.isNaN(n)) throw badRequest(`${name} must be a number`)
  return n
}

export function parseQuery(params: Record<string, unknown>): repo.ProductQuery {
  const specFilters: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('spec.')) specFilters[key.slice(5)] = list(value)
  }
  const page = num(params.page, 'page') ?? 0
  const size = num(params.size, 'size') ?? 24
  if (!Number.isInteger(page) || page < 0) throw badRequest('page must be >= 0')
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) throw badRequest(`size must be 1-${MAX_PAGE_SIZE}`)
  const q = first(params.q) ?? null
  if (q && q.length > 200) throw badRequest('q is too long')
  const sortRaw = (first(params.sort) ?? 'RELEVANCE').toUpperCase()
  if (!['RELEVANCE', 'PRICE_ASC', 'PRICE_DESC', 'RATING', 'NEWEST'].includes(sortRaw)) throw badRequest(`Unknown sort '${first(params.sort)}'`)
  return {
    q,
    category: first(params.category) ?? null,
    brands: list(params.brand),
    minPrice: num(params.minPrice, 'minPrice'),
    maxPrice: num(params.maxPrice, 'maxPrice'),
    minRating: num(params.minRating, 'minRating'),
    inStockOnly: first(params.inStock)?.toLowerCase() === 'true',
    specFilters,
    sort: sortRaw as repo.Sort,
    page,
    size,
  }
}

catalogRouter.get(
  '/api/catalog/products',
  handler(async (req, res) => {
    const q = parseQuery(req.query as Record<string, unknown>)
    const [{ items, total }, facets] = await Promise.all([repo.searchWithCount(q), repo.facetsAndPrice(q)])
    res.json({ items, page: q.page, size: q.size, totalItems: total, totalPages: Math.ceil(total / q.size), facets })
  }),
)

/** Summaries for a set of ids (guest cart). Unknown ids are skipped. */
catalogRouter.get(
  '/api/catalog/products/batch',
  handler(async (req, res) => {
    const ids = [...new Set(list(req.query.ids))]
    if (ids.length > 50) throw badRequest('At most 50 ids')
    res.json(await repo.findByIds(ids))
  }),
)

catalogRouter.get(
  '/api/catalog/products/:idOrSlug',
  handler(async (req, res) => {
    const key = String(req.params.idOrSlug)
    const row = await repo.findByIdOrSlug(key)
    if (!row) throw notFound(`Product '${key}' not found`)
    const p = row.summary
    const [breadcrumbs, stock, related, promotion] = await Promise.all([
      repo.breadcrumbs(row.categoryPath),
      repo.stockByWarehouse(p.id),
      repo.related(p.id, row.category, p.price, 8),
      repo.activePromotion(p.id),
    ])
    res.json({ product: p, description: row.description, images: row.images, tags: row.tags, breadcrumbs, stockByWarehouse: stock, related, promotion, sizeChart: row.sizeChart })
  }),
)

catalogRouter.get(
  '/api/catalog/compare',
  handler(async (req, res) => {
    const ids = [...new Set(list(req.query.ids).map((s) => s.toUpperCase()))]
    if (ids.length < 2 || ids.length > MAX_COMPARE) throw badRequest(`Compare needs between 2 and ${MAX_COMPARE} products`)
    const found = new Map((await repo.findByIds(ids)).map((p) => [p.id, p]))
    res.json(
      ids.map((id) => {
        const p = found.get(id)
        if (!p) throw notFound(`Product '${id}' not found`)
        return p
      }),
    )
  }),
)

catalogRouter.get(
  '/api/catalog/suggest',
  handler(async (req, res) => {
    const q = (first(req.query.q) ?? '').slice(0, 80)
    res.json(q.length < 2 ? [] : await repo.suggest(q))
  }),
)
