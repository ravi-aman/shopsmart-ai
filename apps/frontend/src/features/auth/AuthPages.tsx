import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { buttonStyles, Spinner } from '@/components/Bits'
import { useAuth } from '@/features/auth/authStore'
import { mergeGuestCart } from '@/features/cart/useCart'
import { api, ApiError } from '@/lib/api'
import { regionLabel } from '@/lib/format'
import type { User } from '@/lib/types'

interface AuthResponse {
  token: string
  user: User
}

const loginSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters').max(72),
  region: z.enum(['IN-WEST', 'IN-NORTH', 'IN-SOUTH', 'IN-EAST']),
})

function useCompleteSignIn() {
  const signIn = useAuth((s) => s.signIn)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

  return async (res: AuthResponse) => {
    signIn(res.token, res.user)
    try {
      await mergeGuestCart()
    } catch {
      /* guest cart stays local; user can re-add */
    }
    await qc.invalidateQueries()
    navigate(safeNext, { replace: true })
  }
}

export function LoginPage() {
  const token = useAuth((s) => s.token)
  const complete = useCompleteSignIn()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })

  if (token) return <Navigate to="/" replace />

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      await complete(await api<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(values) }))
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : 'Could not sign in')
    }
  })

  return (
    <AuthShell title="Sign in" subtitle="Welcome back to ShopSmart">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          <input type="email" autoComplete="email" {...form.register('email')} className={inputClass} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <input type="password" autoComplete="current-password" {...form.register('password')} className={inputClass} />
        </Field>
        {serverError && <p className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-stock-out">{serverError}</p>}
        <button type="submit" disabled={form.formState.isSubmitting} className={`${buttonStyles.primary} w-full`}>
          {form.formState.isSubmitting && <Spinner />} Sign in
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        New to ShopSmart?{' '}
        <Link to={`/register${location.search}`} className="font-semibold text-accent hover:underline">
          Create an account
        </Link>
      </p>
      <p className="mt-4 rounded-md bg-canvas px-3 py-2 text-xs text-ink-muted">
        Demo accounts: basic@, prime@, premium@, admin@ and ops@shopsmart.dev — password is <code>DEMO_USER_PASSWORD</code>{' '}
        from the backend <code>.env</code>.
      </p>
    </AuthShell>
  )
}

export function RegisterPage() {
  const token = useAuth((s) => s.token)
  const complete = useCompleteSignIn()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { region: 'IN-WEST' },
  })

  if (token) return <Navigate to="/" replace />

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      await complete(await api<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(values) }))
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : 'Could not create the account')
    }
  })

  return (
    <AuthShell title="Create account" subtitle="New accounts start on the Basic membership tier">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Full name" error={form.formState.errors.name?.message}>
          <input autoComplete="name" {...form.register('name')} className={inputClass} />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <input type="email" autoComplete="email" {...form.register('email')} className={inputClass} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <input type="password" autoComplete="new-password" {...form.register('password')} className={inputClass} />
        </Field>
        <Field label="Delivery region" error={form.formState.errors.region?.message}>
          <select {...form.register('region')} className={inputClass}>
            {Object.entries(regionLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {serverError && <p className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-stock-out">{serverError}</p>}
        <button type="submit" disabled={form.formState.isSubmitting} className={`${buttonStyles.primary} w-full`}>
          {form.formState.isSubmitting && <Spinner />} Create account
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to={`/login${location.search}`} className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}

/** Redirects to sign-in, remembering where the user was going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token)
  const location = useLocation()
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return children
}

export const inputClass =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm focus:border-ink focus:outline-none aria-[invalid=true]:border-stock-out'

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-stock-out">{error}</span>}
    </label>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-card border border-line bg-surface p-6 md:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
