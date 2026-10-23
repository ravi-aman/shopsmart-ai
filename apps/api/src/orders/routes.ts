import { Router } from 'express'
import { z } from 'zod'
import { REGIONS } from '../models/index.js'
import { requireUser, signedIn, staffOnly } from '../http/auth.js'
import { handler, notFound, parse } from '../http/errors.js'
import { openSse } from '../http/sse.js'
import { Order } from '../models/index.js'
import { events } from '../notifications/service.js'
import * as orders from './service.js'

const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^\d{6}$/, 'must be a 6-digit PIN code'),
  region: z.enum(REGIONS, { message: 'unknown region' }),
  phone: z.string().regex(/^[0-9+ -]{8,15}$/, 'must be a valid phone number'),
})

export const ordersRouter = Router()

/** Server-side price, discounts, delivery fee and promised date for the current cart. */
ordersRouter.post(
  '/api/orders/quote',
  signedIn,
  handler(async (req, res) => {
    const { region } = parse(z.object({ region: z.enum(REGIONS) }), req.body)
    const { lines: _lines, ...q } = await orders.quote(requireUser(req), region)
    res.json(q)
  }),
)

/** Payment is simulated (out of scope in the brief): placing the order reserves stock and creates the shipment. */
ordersRouter.post(
  '/api/orders/checkout',
  signedIn,
  handler(async (req, res) => {
    const { address } = parse(z.object({ address: addressSchema }), req.body)
    res.status(201).json(await orders.checkout(requireUser(req), address))
  }),
)

ordersRouter.get(
  '/api/orders',
  signedIn,
  handler(async (req, res) => {
    res.json(await orders.list(requireUser(req).id))
  }),
)

ordersRouter.get(
  '/api/orders/:id',
  signedIn,
  handler(async (req, res) => {
    res.json(await orders.detail(String(req.params.id), requireUser(req)))
  }),
)

/** Live tracking over SSE: sends the current snapshot, then every new shipment event. */
ordersRouter.post(
  '/api/orders/:id/tracking/stream',
  signedIn,
  handler(async (req, res) => {
    const order = await orders.detail(String(req.params.id), requireUser(req)) // ownership check
    const sse = openSse(res)
    sse.send('snapshot', { status: order.status, eta: order.shipment?.eta ?? order.promisedDate, events: order.shipment?.events ?? [] })
    const onEvent = (e: unknown) => sse.send('event', e)
    events.on(`order:${order.id}`, onEvent)
    const ping = setInterval(() => sse.send('ping', {}), 25_000)
    res.on('close', () => {
      clearInterval(ping)
      events.off(`order:${order.id}`, onEvent)
    })
  }),
)

ordersRouter.post(
  '/api/orders/:id/cancel',
  signedIn,
  handler(async (req, res) => {
    res.json(await orders.cancel(String(req.params.id), requireUser(req)))
  }),
)

ordersRouter.post(
  '/api/orders/:id/returns',
  signedIn,
  handler(async (req, res) => {
    const body = parse(z.object({ productId: z.string().min(1).max(20), reason: z.string().trim().min(3).max(500) }), req.body)
    res.json(await orders.requestReturn(String(req.params.id), requireUser(req), body.productId, body.reason))
  }),
)

// ------------------------------------------------------------------ admin

ordersRouter.get(
  '/api/admin/orders',
  staffOnly,
  handler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const rows = await Order.aggregate([
      { $match: status ? { status } : {} },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, membershipTier: 1 } }] } },
      {
        $project: {
          _id: 0,
          id: '$_id',
          status: 1,
          total: 1,
          createdAt: 1,
          promisedDate: 1,
          eta: '$shipment.eta',
          customer: { $first: '$u.name' },
          tier: { $first: '$u.membershipTier' },
          warehouseId: '$warehouse',
          carrier: '$shipment.carrier',
          delayed: { $ifNull: ['$shipment.delayed', false] },
          items: { $sum: '$items.quantity' },
        },
      },
    ])
    res.json(rows)
  }),
)

/** Demo control: move an order to its next delivery status now. */
ordersRouter.post(
  '/api/admin/orders/:id/advance',
  staffOnly,
  handler(async (req, res) => {
    const next = await orders.advance(String(req.params.id))
    if (!next) throw notFound(`Order ${req.params.id} has no next status`)
    res.json({ id: String(req.params.id).toUpperCase(), status: next })
  }),
)
