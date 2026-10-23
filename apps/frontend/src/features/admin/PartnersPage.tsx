import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, MapPin } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { useAuth } from '@/features/auth/authStore'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

interface Partner {
  id: string
  name: string
  kind: 'NGO' | 'COLD_STORAGE'
  email: string
  address: string
  supportedCategories: string[]
  storage: string[]
  capacityUnits: number
  verified: boolean
  active: boolean
  distanceMeters?: number
}

const CENTRES = ['WH-MUM', 'WH-DEL', 'WH-BLR', 'WH-HYD', 'WH-KOL']

/** NGO and cold-storage partners. Only verified, active partners within 3 km receive surplus offers. */
export function PartnersPage() {
  const isAdmin = useAuth((s) => s.user?.role === 'ADMIN')
  const qc = useQueryClient()
  const [centre, setCentre] = useState('WH-MUM')
  const partners = useQuery({ queryKey: ['partners'], queryFn: () => api<Partner[]>('/api/admin/partners') })
  const near = useQuery({ queryKey: ['partners-near', centre], queryFn: () => api<Partner[]>(`/api/admin/partners/near?warehouse=${centre}&category=fresh-pantry&storage=CHILLED`) })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Partner, 'verified' | 'active'>> }) => api(`/api/admin/partners/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] })
      qc.invalidateQueries({ queryKey: ['partners-near'] })
    },
  })

  return (
    <div className="space-y-6">
      <AdminPageHeader title="NGO & cold-storage partners" description="Surplus offers go to the nearest verified, active partner within 3 km that accepts the category and storage type." />

      <section className="rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <MapPin className="size-4 text-ink-muted" aria-hidden />
          <p className="text-sm font-semibold">Who would receive chilled fresh produce from</p>
          <select value={centre} onChange={(e) => setCentre(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm">
            {CENTRES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <ol className="mt-3 space-y-1 text-sm">
          {near.data?.length === 0 && <li className="text-ink-muted">No eligible partner within 3 km — staff get a warning instead.</li>}
          {near.data?.map((p, i) => (
            <li key={p.id}>
              <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">{i + 1}</span>
              {p.name} <span className="text-ink-subtle">· {((p.distanceMeters ?? 0) / 1000).toFixed(1)} km · {p.capacityUnits} units capacity</span>
            </li>
          ))}
        </ol>
      </section>

      {partners.isError && <ErrorState title="Couldn’t load partners" detail={partners.error.message} />}
      {partners.data && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line bg-canvas/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-2.5">Partner</th>
                <th className="px-3 py-2.5">Accepts</th>
                <th className="px-3 py-2.5 text-right">Capacity</th>
                <th className="px-3 py-2.5">Verified</th>
                <th className="px-3 py-2.5">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {partners.data.map((p) => (
                <tr key={p.id} className={cn(!p.active && 'opacity-60')}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-ink-subtle">{p.kind === 'NGO' ? 'NGO' : 'Cold storage'} · {p.email}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-muted">{p.supportedCategories.join(', ')}<span className="block">{p.storage.join(' · ').toLowerCase()}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.capacityUnits}</td>
                  <td className="px-3 py-2.5">
                    {p.verified ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-stock-in"><BadgeCheck className="size-4" aria-hidden /> Verified</span>
                    ) : isAdmin ? (
                      <button type="button" onClick={() => update.mutate({ id: p.id, patch: { verified: true } })} className="text-xs font-semibold text-accent hover:underline">Verify</button>
                    ) : (
                      <span className="text-xs text-ink-subtle">Pending</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <label className="inline-flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={p.active} disabled={!isAdmin || update.isPending} onChange={(e) => update.mutate({ id: p.id, patch: { active: e.target.checked } })} />
                      {p.active ? 'Active' : 'Paused'}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isAdmin && <p className="text-xs text-ink-subtle">Only admins can verify or pause partners.</p>}
      {update.isError && <p className="text-sm text-stock-out">{update.error.message}</p>}
    </div>
  )
}
