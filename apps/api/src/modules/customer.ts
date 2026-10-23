import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { issueToken, requireUser, signedIn } from '../http/auth.js'
import { ApiError, handler, notFound, parse } from '../http/errors.js'
import { REGIONS, User, type UserDoc } from '../models/index.js'

export function publicUser(u: UserDoc) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    membershipTier: effectiveTier(u),
    region: u.region,
    premiumUntil: u.premiumUntil ?? null,
    createdAt: u.createdAt,
  }
}

/** Paid tiers lapse back to BASIC when premiumUntil has passed — the server decides, never the client. */
export function effectiveTier(u: { membershipTier: string; premiumUntil?: Date | null }) {
  if (u.membershipTier !== 'BASIC' && u.premiumUntil && u.premiumUntil.getTime() < Date.now()) return 'BASIC'
  return u.membershipTier
}

export interface Preferences {
  preferredCategories: string[]
  preferredBrands: string[]
  useCases: string[]
  budgetMin: number | null
  budgetMax: number | null
}

export async function findPreferences(userId: string): Promise<Preferences> {
  const u = await User.findById(userId).select('preferences').lean()
  const p = u?.preferences
  return {
    preferredCategories: p?.preferredCategories ?? [],
    preferredBrands: p?.preferredBrands ?? [],
    useCases: p?.useCases ?? [],
    budgetMin: p?.budgetMin ?? null,
    budgetMax: p?.budgetMax ?? null,
  }
}

const registerSchema = z.object({
  name: z.string().trim().min(1, 'must not be blank').max(120),
  email: z.email('must be a well-formed email address').max(255),
  password: z.string().min(8, 'must be 8–72 characters').max(72, 'must be 8–72 characters'),
  region: z.enum(REGIONS).optional(),
})

const loginSchema = z.object({
  email: z.email('must be a well-formed email address'),
  password: z.string().min(1, 'must not be blank'),
})

const prefsSchema = z
  .object({
    preferredCategories: z.array(z.string().max(80)).max(20),
    preferredBrands: z.array(z.string().max(120)).max(20),
    useCases: z.array(z.string().max(80)).max(10),
    budgetMin: z.number().min(0).nullable().optional(),
    budgetMax: z.number().min(0).nullable().optional(),
  })
  .refine((p) => p.budgetMin == null || p.budgetMax == null || p.budgetMin <= p.budgetMax, { message: 'budgetMin must not exceed budgetMax', path: ['budgetMin'] })

const measurementsSchema = z.object({
  chestCm: z.number().min(50).max(200).nullable(),
  waistCm: z.number().min(40).max(200).nullable(),
  footLengthCm: z.number().min(15).max(35).nullable(),
})

export const customerRouter = Router()

customerRouter.post(
  '/api/auth/register',
  handler(async (req, res) => {
    const body = parse(registerSchema, req.body)
    if (await User.exists({ email: body.email.toLowerCase() })) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
    const user = await User.create({ name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 10), region: body.region ?? 'IN-WEST' })
    const u = user.toObject() as unknown as UserDoc
    res.status(201).json({ token: await issueToken(u), user: publicUser(u) })
  }),
)

customerRouter.post(
  '/api/auth/login',
  handler(async (req, res) => {
    const body = parse(loginSchema, req.body)
    const user = await User.findOne({ email: body.email.trim().toLowerCase() }).select('+passwordHash').lean<UserDoc>()
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended')
    res.json({ token: await issueToken(user), user: publicUser(user) })
  }),
)

customerRouter.get(
  '/api/me',
  signedIn,
  handler(async (req, res) => {
    const user = await User.findById(requireUser(req).id).lean<UserDoc>()
    if (!user) throw notFound('User no longer exists')
    res.json({ ...publicUser(user), measurements: user.measurements, notificationPrefs: user.notificationPrefs })
  }),
)

customerRouter.get(
  '/api/me/preferences',
  signedIn,
  handler(async (req, res) => {
    res.json(await findPreferences(requireUser(req).id))
  }),
)

customerRouter.put(
  '/api/me/preferences',
  signedIn,
  handler(async (req, res) => {
    const p = parse(prefsSchema, req.body)
    const prefs: Preferences = { ...p, budgetMin: p.budgetMin ?? null, budgetMax: p.budgetMax ?? null }
    await User.updateOne({ _id: requireUser(req).id }, { $set: { preferences: prefs } })
    res.json(prefs)
  }),
)

customerRouter.put(
  '/api/me/measurements',
  signedIn,
  handler(async (req, res) => {
    const m = parse(measurementsSchema, req.body)
    await User.updateOne({ _id: requireUser(req).id }, { $set: { measurements: m } })
    res.json(m)
  }),
)

customerRouter.put(
  '/api/me/notification-preferences',
  signedIn,
  handler(async (req, res) => {
    const p = parse(z.object({ email: z.boolean(), inApp: z.boolean() }), req.body)
    await User.updateOne({ _id: requireUser(req).id }, { $set: { notificationPrefs: p } })
    res.json(p)
  }),
)
