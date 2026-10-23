import type { Request } from 'express'
import { config } from '../config.js'
import { ApiError } from '../http/errors.js'
import { usedToday } from './audit.js'

const windows = new Map<string, { minute: number; count: number }>()

/**
 * Two limits on AI endpoints: a per-minute burst limit (in memory, per user or IP) and a daily quota
 * per signed-in user that depends on membership tier.
 */
export async function checkRateLimit(req: Request, prefix = '') {
  const key = prefix + (req.user ? `u:${req.user.id}` : `ip:${req.ip}`)
  const minute = Math.floor(Date.now() / 60_000)
  const w = windows.get(key)
  const next = !w || w.minute !== minute ? { minute, count: 1 } : { minute, count: w.count + 1 }
  windows.set(key, next)
  if (windows.size > 10_000) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k)
  if (next.count > config.AI_RATE_LIMIT_PER_MINUTE) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many assistant requests — please wait a minute and try again')
  }
  if (req.user && req.user.role === 'CUSTOMER') {
    const limit = req.user.tier === 'BASIC' ? config.AI_DAILY_LIMIT_BASIC : config.AI_DAILY_LIMIT_PREMIUM
    if ((await usedToday(req.user.id)) >= limit) {
      throw new ApiError(429, 'DAILY_AI_LIMIT', `You've used today's ${limit} assistant requests${req.user.tier === 'BASIC' ? ' — Prime and Premium include more' : ''}.`)
    }
  }
}
