import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'

interface Health {
  status: string
  database: string
  pgvector: string
  products: number
  knowledgeChunks: number
}

export function StatusPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/api/health') })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">System status</h1>
      <p className="mt-1 text-sm text-ink-muted">Backend, Supabase database and pgvector.</p>

      <div className="mt-6 rounded-card border border-line bg-surface">
        {health.isPending && <p className="p-4 text-sm text-ink-muted">Checking backend…</p>}
        {health.isError && (
          <p className="p-4 text-sm text-stock-out">
            Backend unreachable:{' '}
            {health.error instanceof ApiError ? health.error.message : 'is the Spring Boot app running on :8080?'}
          </p>
        )}
        {health.data && (
          <dl className="divide-y divide-line text-sm">
            <Row label="API" value={health.data.status} ok={health.data.status === 'UP'} />
            <Row label="Database" value={health.data.database.split(' on ')[0]} ok />
            <Row label="pgvector" value={health.data.pgvector} ok={health.data.pgvector !== 'NOT INSTALLED'} />
            <Row label="Products" value={String(health.data.products)} ok={health.data.products > 0} />
            <Row label="Knowledge chunks" value={String(health.data.knowledgeChunks)} ok={health.data.knowledgeChunks > 0} />
          </dl>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="flex items-center gap-2 font-medium">
        <span className={cn('size-2 rounded-full', ok ? 'bg-stock-in' : 'bg-stock-low')} aria-hidden />
        {value}
      </dd>
    </div>
  )
}
