import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { inputClass } from '@/features/auth/AuthPages'
import { useAuth } from '@/features/auth/authStore'
import { api } from '@/lib/api'
import { regionLabel } from '@/lib/format'
import type { CategoryNode, Preferences, User } from '@/lib/types'

const useCaseOptions = ['Software development', 'AI / machine learning', 'Gaming', 'Office work', 'Student', 'Travel', 'Content creation', 'Home cooking', 'Fitness']

const tierStyle: Record<User['membershipTier'], string> = {
  BASIC: 'bg-canvas text-ink',
  PRIME: 'bg-[#e7f0ff] text-[#1d4ed8]',
  PREMIUM: 'bg-[#1a1a1a] text-[#f3d27a]',
}

export function AccountPage() {
  const signOut = useAuth((s) => s.signOut)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/api/me') })
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: () => api<Preferences>('/api/me/preferences') })

  if (me.isError) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorState title="Couldn’t load your account" detail={me.error.message} /></div>
  if (!me.data || !prefs.data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-ink-muted">Loading…</div>

  const user = me.data
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-card border border-line bg-surface p-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
          <p className="text-sm text-ink-muted">{user.email}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className={`rounded-full px-2.5 py-1 ${tierStyle[user.membershipTier]}`}>{user.membershipTier} member</span>
            <span className="rounded-full bg-canvas px-2.5 py-1">{regionLabel[user.region] ?? user.region}</span>
            {user.role !== 'CUSTOMER' && <span className="rounded-full bg-ai-soft px-2.5 py-1 text-ai">{user.role}</span>}
          </div>
        </div>
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => {
            signOut()
            qc.clear()
            navigate('/')
          }}
        >
          Sign out
        </button>
      </div>

      <PreferencesForm initial={prefs.data} />
    </div>
  )
}

function PreferencesForm({ initial }: { initial: Preferences }) {
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<CategoryNode[]>('/api/catalog/categories'), staleTime: 300_000 })
  const [cats, setCats] = useState<string[]>(initial.preferredCategories)
  const [uses, setUses] = useState<string[]>(initial.useCases)
  const [brands, setBrands] = useState<string[]>(initial.preferredBrands)
  const [brandInput, setBrandInput] = useState('')
  const [min, setMin] = useState(initial.budgetMin?.toString() ?? '')
  const [max, setMax] = useState(initial.budgetMax?.toString() ?? '')

  const invalidBudget = min !== '' && max !== '' && Number(min) > Number(max)
  const save = useMutation({
    mutationFn: () =>
      api<Preferences>('/api/me/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          preferredCategories: cats,
          preferredBrands: brands,
          useCases: uses,
          budgetMin: min === '' ? null : Number(min),
          budgetMax: max === '' ? null : Number(max),
        }),
      }),
    onSuccess: (data) => qc.setQueryData(['preferences'], data),
  })

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  const leafCategories = (categories.data ?? []).flatMap((top) => top.children.map((c) => ({ ...c, parent: top.name })))

  return (
    <form
      className="mt-6 rounded-card border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!invalidBudget) save.mutate()
      }}
    >
      <h2 className="text-lg font-semibold">Shopping preferences</h2>
      <p className="mt-0.5 text-sm text-ink-muted">The AI assistant uses these to tailor recommendations.</p>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">What do you shop for?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {leafCategories.map((c) => (
            <Chip key={c.slug} active={cats.includes(c.slug)} onClick={() => toggle(cats, setCats, c.slug)}>
              {c.name}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">How will you use what you buy?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {useCaseOptions.map((u) => (
            <Chip key={u} active={uses.includes(u)} onClick={() => toggle(uses, setUses, u)}>
              {u}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Favourite brands</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {brands.map((b) => (
            <span key={b} className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white">
              {b}
              <button type="button" onClick={() => setBrands(brands.filter((x) => x !== b))} aria-label={`Remove ${b}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={brandInput}
            onChange={(e) => setBrandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && brandInput.trim()) {
                e.preventDefault()
                if (!brands.includes(brandInput.trim()) && brands.length < 20) setBrands([...brands, brandInput.trim()])
                setBrandInput('')
              }
            }}
            placeholder="Type a brand, press Enter"
            className="min-w-[180px] flex-1 rounded-md border border-line-strong px-3 py-1.5 text-sm"
          />
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Typical budget (USD)</legend>
        <div className="mt-2 flex max-w-sm items-center gap-2">
          <input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min" aria-label="Minimum budget" className={inputClass} />
          <span className="text-ink-subtle">–</span>
          <input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" aria-label="Maximum budget" className={inputClass} />
        </div>
        {invalidBudget && <p className="mt-1 text-xs text-stock-out">Minimum is higher than maximum</p>}
      </fieldset>

      <div className="mt-6 flex items-center gap-3">
        <button type="submit" disabled={save.isPending || invalidBudget} className={buttonStyles.primary}>
          {save.isPending && <Spinner />} Save preferences
        </button>
        {save.isSuccess && !save.isPending && (
          <span className="inline-flex items-center gap-1 text-sm text-stock-in">
            <Check className="size-4" aria-hidden /> Saved
          </span>
        )}
        {save.isError && <span className="text-sm text-stock-out">{save.error.message}</span>}
      </div>
    </form>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-white'
          : 'rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm hover:border-ink'
      }
    >
      {children}
    </button>
  )
}
