import type { NextFunction, Request, Response } from 'express'
import { jwtVerify, SignJWT } from 'jose'
import { config } from '../config.js'
import { ApiError, problem } from './errors.js'

export type Role = 'CUSTOMER' | 'ADMIN' | 'OPS' | 'PARTNER'
export type Tier = 'BASIC' | 'PRIME' | 'PREMIUM'

export interface CurrentUser {
  id: string
  email: string
  name: string
  role: Role
  tier: Tier
  region: string
  partnerId: string | null
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: CurrentUser
  }
}

const key = new TextEncoder().encode(config.JWT_SECRET)

export async function issueToken(u: { _id: unknown; email: string; name: string; role: string; membershipTier: string; region: string; premiumUntil?: Date | null; partner?: unknown }) {
  const lapsed = u.membershipTier !== 'BASIC' && u.premiumUntil && u.premiumUntil.getTime() < Date.now()
  return new SignJWT({
    email: u.email,
    name: u.name,
    roles: [u.role],
    tier: lapsed ? 'BASIC' : u.membershipTier,
    region: u.region,
    partner: u.partner ? String(u.partner) : null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('shopsmart')
    .setSubject(String(u._id))
    .setIssuedAt()
    .setExpirationTime(`${config.JWT_TTL_MINUTES}m`)
    .sign(key)
}

/**
 * Reads a Bearer token if present. An invalid or expired token is a 401 even on public routes, so
 * the frontend signs the user out instead of silently acting anonymously. Role and tier come only
 * from the signed token (issued from the database), never from request bodies.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next()
  try {
    const { payload } = await jwtVerify(header.slice(7), key, { algorithms: ['HS256'], issuer: 'shopsmart' })
    const roles = (payload.roles as string[] | undefined) ?? []
    req.user = {
      id: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name ?? payload.email),
      role: (roles[0] as Role) ?? 'CUSTOMER',
      tier: (payload.tier as Tier) ?? 'BASIC',
      region: String(payload.region ?? 'IN-WEST'),
      partnerId: (payload.partner as string | null) ?? null,
    }
    next()
  } catch {
    problem(res, req, 401, 'UNAUTHORIZED', 'Your session has expired — please sign in again')
  }
}

export function requireUser(req: Request): CurrentUser {
  if (!req.user) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue')
  return req.user
}

export const isStaff = (u: CurrentUser | undefined) => !!u && (u.role === 'ADMIN' || u.role === 'OPS')

export function requireStaff(req: Request): CurrentUser {
  const u = requireUser(req)
  if (!isStaff(u)) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this resource')
  return u
}

export function requireAdmin(req: Request): CurrentUser {
  const u = requireUser(req)
  if (u.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Only administrators can do this')
  return u
}

export function requirePartner(req: Request): CurrentUser & { partnerId: string } {
  const u = requireUser(req)
  if (u.role !== 'PARTNER' || !u.partnerId) throw new ApiError(403, 'FORBIDDEN', 'Partner account required')
  return u as CurrentUser & { partnerId: string }
}

/** Premium features (fit advice, bundles, advanced checkout) — PRIME and PREMIUM. */
export function requirePremium(req: Request): CurrentUser {
  const u = requireUser(req)
  if (u.tier === 'BASIC' && !isStaff(u)) throw new ApiError(403, 'PREMIUM_REQUIRED', 'This feature is part of Prime and Premium membership')
  return u
}

const guard = (check: (req: Request) => unknown) => (req: Request, _res: Response, next: NextFunction) => {
  try {
    check(req)
    next()
  } catch (e) {
    next(e)
  }
}

export const signedIn = guard(requireUser)
export const staffOnly = guard(requireStaff)
export const adminOnly = guard(requireAdmin)
export const partnerOnly = guard(requirePartner)
export const premiumOnly = guard(requirePremium)
