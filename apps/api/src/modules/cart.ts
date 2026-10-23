import { Router } from 'express'
import { z } from 'zod'
import { requireUser, signedIn } from '../http/auth.js'
import { ApiError, handler, notFound, parse } from '../http/errors.js'
import { Cart, Product, Wishlist } from '../models/index.js'
import { findByIds, type ProductSummary } from './catalog/repository.js'

export const MAX_QUANTITY = 20

export interface CartLine {
  productId: string
  quantity: number
  product: ProductSummary
  lineTotal: number
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Prices always come from the catalogue at read time — never from the client or the snapshot. */
export async function cartView(userId: string) {
  const cart = await Cart.findOne({ user: userId }).lean()
  const lines = cart?.items ?? []
  if (lines.length === 0) return { items: [] as CartLine[], itemCount: 0, subtotal: 0, savings: 0 }
  const products = new Map((await findByIds(lines.map((l) => l.product))).map((p) => [p.id, p]))
  const items: CartLine[] = lines.flatMap((l) => {
    const p = products.get(l.product)
    return p ? [{ productId: p.id, quantity: l.quantity, product: p, lineTotal: round2(p.price * l.quantity) }] : []
  })
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: round2(items.reduce((n, i) => n + i.lineTotal, 0)),
    savings: round2(items.reduce((n, i) => n + (i.product.mrp ? (i.product.mrp - i.product.price) * i.quantity : 0), 0)),
  }
}

async function requireAvailable(productId: string, quantity: number) {
  const [p] = await findByIds([productId])
  if (!p) throw notFound(`Product '${productId}' not found`)
  if (p.availableQuantity <= 0) throw new ApiError(409, 'OUT_OF_STOCK', `${p.name} is out of stock`)
  if (quantity > p.availableQuantity) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${p.availableQuantity} of ${p.name} available`)
  return p
}

export async function setQuantity(userId: string, productId: string, quantity: number) {
  const id = productId.toUpperCase()
  if (quantity <= 0) {
    await Cart.updateOne({ user: userId }, { $pull: { items: { product: id } } })
    return
  }
  const p = await requireAvailable(id, quantity)
  // update in place if present, otherwise push — two atomic steps, no read-modify-write race
  const updated = await Cart.updateOne({ user: userId, 'items.product': p.id }, { $set: { 'items.$.quantity': quantity, 'items.$.priceSnapshot': p.price } })
  if (updated.matchedCount === 0) {
    await Cart.updateOne({ user: userId }, { $push: { items: { product: p.id, quantity, priceSnapshot: p.price } } }, { upsert: true })
  }
}

const quantitySchema = z.object({ quantity: z.number().int().min(0).max(MAX_QUANTITY, `must be less than or equal to ${MAX_QUANTITY}`) })
const mergeSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(MAX_QUANTITY) })).max(50),
})

export const cartRouter = Router()

cartRouter.get(
  '/api/cart',
  signedIn,
  handler(async (req, res) => {
    res.json(await cartView(requireUser(req).id))
  }),
)

cartRouter.put(
  '/api/cart/items/:productId',
  signedIn,
  handler(async (req, res) => {
    const { quantity } = parse(quantitySchema, req.body)
    const user = requireUser(req)
    await setQuantity(user.id, String(req.params.productId), quantity)
    res.json(await cartView(user.id))
  }),
)

cartRouter.delete(
  '/api/cart/items/:productId',
  signedIn,
  handler(async (req, res) => {
    const user = requireUser(req)
    await setQuantity(user.id, String(req.params.productId), 0)
    res.json(await cartView(user.id))
  }),
)

/** Adds guest quantities on top of the saved cart, capped at stock and MAX_QUANTITY. Unknown items are skipped. */
cartRouter.post(
  '/api/cart/merge',
  signedIn,
  handler(async (req, res) => {
    const { items } = parse(mergeSchema, req.body)
    const user = requireUser(req)
    const current = new Map(((await Cart.findOne({ user: user.id }).lean())?.items ?? []).map((i) => [i.product, i.quantity]))
    for (const item of items) {
      const [p] = await findByIds([item.productId])
      if (!p || p.availableQuantity <= 0) continue
      const cap = Math.min(MAX_QUANTITY, p.availableQuantity)
      await setQuantity(user.id, p.id, Math.min((current.get(p.id) ?? 0) + item.quantity, cap))
    }
    res.json(await cartView(user.id))
  }),
)

// ------------------------------------------------------------------ wishlist

const wishlistIds = async (userId: string) => (await Wishlist.find({ user: userId }).sort({ createdAt: -1 }).lean()).map((w) => w.product)

cartRouter.get(
  '/api/wishlist',
  signedIn,
  handler(async (req, res) => {
    const ids = await wishlistIds(requireUser(req).id)
    const products = new Map((await findByIds(ids)).map((p) => [p.id, p]))
    res.json(ids.flatMap((id) => (products.has(id) ? [products.get(id)] : [])))
  }),
)

cartRouter.get(
  '/api/wishlist/ids',
  signedIn,
  handler(async (req, res) => {
    res.json(await wishlistIds(requireUser(req).id))
  }),
)

cartRouter.put(
  '/api/wishlist/:productId',
  signedIn,
  handler(async (req, res) => {
    const id = String(req.params.productId).toUpperCase()
    if (!(await Product.exists({ _id: id }))) throw notFound(`Product '${id}' not found`)
    await Wishlist.updateOne({ user: requireUser(req).id, product: id }, { $setOnInsert: { user: requireUser(req).id, product: id } }, { upsert: true })
    res.status(204).end()
  }),
)

cartRouter.delete(
  '/api/wishlist/:productId',
  signedIn,
  handler(async (req, res) => {
    await Wishlist.deleteOne({ user: requireUser(req).id, product: String(req.params.productId).toUpperCase() })
    res.status(204).end()
  }),
)
