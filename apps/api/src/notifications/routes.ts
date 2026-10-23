import { Router } from 'express'
import mongoose from 'mongoose'
import { requireUser, signedIn } from '../http/auth.js'
import { handler, notFound } from '../http/errors.js'
import { openSse } from '../http/sse.js'
import { Notification } from '../models/index.js'
import { events } from './service.js'

export const notificationsRouter = Router()

notificationsRouter.get(
  '/api/notifications',
  signedIn,
  handler(async (req, res) => {
    const user = requireUser(req)
    const [items, unread] = await Promise.all([
      Notification.find({ user: user.id }).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ user: user.id, read: false }),
    ])
    res.json({
      unread,
      items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: (n as unknown as { createdAt: Date }).createdAt })),
    })
  }),
)

notificationsRouter.patch(
  '/api/notifications/:id/read',
  signedIn,
  handler(async (req, res) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) throw notFound('Notification not found')
    const r = await Notification.updateOne({ _id: id, user: requireUser(req).id }, { read: true })
    if (r.matchedCount === 0) throw notFound('Notification not found')
    res.status(204).end()
  }),
)

notificationsRouter.post(
  '/api/notifications/read-all',
  signedIn,
  handler(async (req, res) => {
    await Notification.updateMany({ user: requireUser(req).id, read: false }, { read: true })
    res.status(204).end()
  }),
)

/** Live notification feed over SSE (POST so the bearer token travels in a header); clients also poll as a fallback. */
notificationsRouter.post(
  '/api/notifications/stream',
  signedIn,
  (req, res) => {
    const user = requireUser(req)
    const sse = openSse(res)
    const onEvent = (payload: unknown) => sse.send('notification', payload)
    events.on(`notify:${user.id}`, onEvent)
    const ping = setInterval(() => sse.send('ping', {}), 25_000)
    res.on('close', () => {
      clearInterval(ping)
      events.off(`notify:${user.id}`, onEvent)
    })
  },
)
