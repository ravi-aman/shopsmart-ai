import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'

interface Health {
  status: string
  database: string
  search: string
  vectorSearch: string
  transactions: boolean
  products: number
  knowledgeChunks: number
  ai: string
  email: string
}

export function StatusPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/api/health') })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">System status</h1>
      <p className="mt-1 text-sm text-ink-muted">API, MongoDB, search indexes, NVIDIA models and email.</p>

      <div className="mt-6 rounded-card border border-line bg-surface">
        {health.isPending && <p className="p-4 text-sm text-ink-muted">Checking the API…</p>}
        {health.isError && (
          <p className="p-4 text-sm text-stock-out">
            API unreachable:{' '}
            {health.error instanceof ApiError ? health.error.message : 'is the API running (npm run dev:api)?'}
          </p>
        )}
        {health.data && (
          <dl className="divide-y divide-line text-sm">
            <Row label="API" value={health.data.status} ok={health.data.status === 'UP'} />
            <Row label="Database" value={health.data.database} ok />
            <Row label="Transactions" value={health.data.transactions ? 'Replica set' : 'Standalone (no transactions)'} ok={health.data.transactions} />
            <Row label="Product search" value={health.data.search} ok={health.data.search.startsWith('Atlas')} />
            <Row label="Vector search" value={health.data.vectorSearch} ok={health.data.vectorSearch.startsWith('Atlas')} />
            <Row label="AI models" value={health.data.ai} ok={!health.data.ai.startsWith('fallback')} />
            <Row label="Email" value={health.data.email} ok={!health.data.email.startsWith('disabled')} />
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
