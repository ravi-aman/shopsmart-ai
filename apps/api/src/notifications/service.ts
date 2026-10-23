import { EventEmitter } from 'node:events'
import nodemailer from 'nodemailer'
import { config, smtpConfigured } from '../config.js'
import { logger } from '../logger.js'
import { Notification, User } from '../models/index.js'

type NotificationType = 'RESTOCK' | 'ORDER_STATUS' | 'NEAR_EXPIRY' | 'DISCOUNT' | 'SUPPORT' | 'RETURN_STATUS' | 'PARTNER_OFFER' | 'ADMIN_WARNING'

/** In-process event bus: order tracking streams and notification badges subscribe to it. */
export const events = new EventEmitter()
events.setMaxListeners(1000)

const transport = smtpConfigured()
  ? nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465, auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined })
  : null

/** Sends an email if SMTP is configured; otherwise logs it and reports SKIPPED (never pretends to have sent). */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string }> {
  if (!transport) {
    logger.info({ to, subject }, 'email skipped (SMTP not configured)')
    return { status: 'SKIPPED' }
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await transport.sendMail({ from: config.EMAIL_FROM, to, subject, text })
      return { status: 'SENT' }
    } catch (e) {
      if (attempt === 2) {
        logger.warn({ to, subject, err: (e as Error).message }, 'email failed')
        return { status: 'FAILED', error: (e as Error).message }
      }
    }
  }
  return { status: 'FAILED' }
}

export interface NotifyInput {
  userId: string
  type: NotificationType
  title: string
  body: string
  link?: string | null
  /** Same key → delivered once (jobs can re-run safely). */
  dedupeKey?: string
  email?: boolean
}

/**
 * Creates an in-app notification (respecting the user's preferences), optionally emails it, and
 * pushes it to live listeners. Duplicate keys are ignored, so background jobs stay idempotent.
 */
export async function notify(n: NotifyInput) {
  const user = await User.findById(n.userId).select('email notificationPrefs').lean()
  if (!user) return null
  let doc
  try {
    doc = await Notification.create({ user: n.userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return null // already delivered
    throw e
  }
  events.emit(`notify:${n.userId}`, { id: String(doc._id), type: n.type, title: n.title, body: n.body, link: n.link ?? null })
  if (n.email && user.notificationPrefs?.email !== false) {
    const r = await sendEmail(user.email, n.title, `${n.body}${n.link ? `\n\n${config.CLIENT_URL}${n.link}` : ''}`)
    await Notification.updateOne({ _id: doc._id }, { email: { status: r.status, at: new Date(), error: r.error } })
  }
  return String(doc._id)
}

/** Notifies every ADMIN/OPS user (e.g. near-expiry alerts). */
export async function notifyStaff(input: Omit<NotifyInput, 'userId'>) {
  const staff = await User.find({ role: { $in: ['ADMIN', 'OPS'] }, status: 'ACTIVE' }).select('_id').lean()
  for (const s of staff) await notify({ ...input, userId: String(s._id), dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${s._id}` : undefined })
}
