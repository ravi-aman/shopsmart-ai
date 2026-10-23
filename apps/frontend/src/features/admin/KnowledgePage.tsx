import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, RefreshCw, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { AdminPageHeader } from '@/features/admin/AdminLayout'
import { inputClass } from '@/features/auth/AuthPages'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

interface DocumentRow {
  id: string
  title: string
  category: string
  region: string
  version: string
  effectiveDate: string
  tiers: string[]
  sourceType: 'PDF' | 'MARKDOWN' | 'JSON'
  fileName: string
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  errorMessage: string | null
  chunkCount: number
  active: boolean
  createdAt: string
}

interface ChunkRow {
  id: string
  content: string
  metadata: { section: string; chunkIndex: number }
  embedded: boolean
}

const categories = ['RETURN', 'REFUND', 'SHIPPING', 'SLA', 'MEMBERSHIP', 'CANCELLATION', 'WARRANTY', 'MANUAL', 'SELLER']
const regions = ['GLOBAL', 'IN-WEST', 'IN-NORTH', 'IN-SOUTH', 'IN-EAST']
const tiers = ['BASIC', 'PRIME', 'PREMIUM']

const statusStyle: Record<DocumentRow['status'], string> = {
  UPLOADED: 'bg-canvas text-ink-muted',
  PROCESSING: 'bg-ai-soft text-ai',
  READY: 'bg-[#e6f4ea] text-stock-in',
  FAILED: 'bg-[#fdecec] text-stock-out',
}

export function KnowledgePage() {
  const [showUpload, setShowUpload] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const docs = useQuery({
    queryKey: ['admin-documents'],
    queryFn: () => api<DocumentRow[]>('/api/admin/documents'),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'PROCESSING' || d.status === 'UPLOADED') ? 1500 : false),
  })

  return (
    <div>
      <AdminPageHeader
        title="Knowledge base"
        description="Approved documents the assistant answers from. Each title has one active version: the latest one in force."
        actions={
          <button type="button" onClick={() => setShowUpload((s) => !s)} className={buttonStyles.primary}>
            <Upload className="size-4" aria-hidden /> Upload document
          </button>
        }
      />

      {showUpload && <UploadForm onDone={() => setShowUpload(false)} />}

      {docs.isError && <ErrorState title="Couldn’t load documents" detail={docs.error.message} onRetry={() => docs.refetch()} />}
      {docs.data && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-canvas/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-3 py-2.5 font-semibold">Version</th>
                <th className="px-3 py-2.5 font-semibold">Category</th>
                <th className="px-3 py-2.5 font-semibold">Effective</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Chunks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {docs.data.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelected(d.id)}
                  className={cn('cursor-pointer hover:bg-canvas/60', selected === d.id && 'bg-ai-soft/50', !d.active && 'text-ink-muted')}
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <FileText className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                      <span className="font-medium">{d.title}</span>
                      <span className="rounded bg-canvas px-1.5 text-[10px] font-semibold text-ink-subtle">{d.sourceType}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {d.version}
                    {d.status === 'READY' && (
                      <span className={cn('ml-2 text-[11px] font-semibold', d.active ? 'text-stock-in' : 'text-ink-subtle')}>
                        {d.active ? 'active' : 'superseded'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{d.category}</td>
                  <td className="px-3 py-2.5 tabular-nums">{d.effectiveDate}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold', statusStyle[d.status])}>
                      {d.status === 'PROCESSING' && <Spinner className="size-3" />}
                      {d.status}
                    </span>
                    {d.errorMessage && <span className="mt-0.5 block max-w-[220px] truncate text-[11px] text-ink-subtle" title={d.errorMessage}>{d.errorMessage}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.chunkCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DocumentChunks id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('RETURN')
  const [version, setVersion] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [region, setRegion] = useState('GLOBAL')
  const [selectedTiers, setSelectedTiers] = useState<string[]>(tiers)

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData()
      body.append('file', file!)
      body.append('title', title.trim())
      body.append('category', category)
      body.append('version', version.trim())
      body.append('effectiveDate', effectiveDate)
      body.append('region', region)
      body.append('tiers', selectedTiers.join(','))
      return api<{ id: string }>('/api/admin/documents', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-documents'] })
      onDone()
    },
  })

  const valid = file && title.trim() && /^[0-9A-Za-z.-]{1,20}$/.test(version.trim()) && selectedTiers.length > 0

  return (
    <form
      className="mb-5 grid gap-4 rounded-card border border-line bg-surface p-5 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) upload.mutate()
      }}
    >
      <div className="md:col-span-2">
        <span className="mb-1 block text-sm font-medium">File (PDF, Markdown or JSON, max 20 MB)</span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-line-strong px-4 py-6 text-sm text-ink-muted hover:border-ink hover:text-ink"
        >
          <Upload className="size-4" aria-hidden />
          {file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'Choose a file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.md,.markdown,.json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
          }}
        />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} placeholder="Laptop Return Policy" />
        <span className="mt-1 block text-xs text-ink-subtle">Same title + newer version replaces the old one.</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Version</span>
        <input value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass} placeholder="2026.2" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Effective date</span>
        <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Region</span>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass}>
          {regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Applies to tiers</legend>
        <div className="flex gap-3 pt-2 text-sm">
          {tiers.map((t) => (
            <label key={t} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selectedTiers.includes(t)}
                onChange={(e) => setSelectedTiers(e.target.checked ? [...selectedTiers, t] : selectedTiers.filter((x) => x !== t))}
                className="accent-[var(--color-accent)]"
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      {upload.isError && <p className="text-sm text-stock-out md:col-span-2">{upload.error.message}</p>}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={!valid || upload.isPending} className={buttonStyles.primary}>
          {upload.isPending && <Spinner />} Upload and index
        </button>
        <button type="button" onClick={onDone} className={buttonStyles.secondary}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function DocumentChunks({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ['admin-document', id],
    queryFn: () => api<{ document: DocumentRow; chunks: ChunkRow[] }>(`/api/admin/documents/${id}`),
  })
  const reprocess = useMutation({
    mutationFn: () => api(`/api/admin/documents/${id}/reprocess`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-documents'] }),
  })

  return (
    <section className="mt-5 rounded-card border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="flex-1 font-semibold">
          {data.data ? `${data.data.document.title} v${data.data.document.version}` : 'Loading…'}
          {data.data && <span className="ml-2 text-xs font-normal text-ink-muted">{data.data.chunks.length} chunks · {data.data.document.fileName}</span>}
        </p>
        <button type="button" onClick={() => reprocess.mutate()} disabled={reprocess.isPending} className={cn(buttonStyles.secondary, 'px-3 py-1.5 text-xs')}>
          <RefreshCw className="size-3.5" aria-hidden /> Re-index
        </button>
        <button type="button" onClick={onClose} className="rounded p-1.5 hover:bg-canvas" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <ol className="max-h-[480px] divide-y divide-line overflow-y-auto">
        {data.data?.chunks.map((c) => (
          <li key={c.id} className="px-4 py-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold text-ink-subtle">
              #{c.metadata.chunkIndex + 1} · {c.metadata.section}
              <span className={cn('rounded px-1.5 py-0.5 text-[10px]', c.embedded ? 'bg-ai-soft text-ai' : 'bg-canvas')}>
                {c.embedded ? 'embedded' : 'keyword only'}
              </span>
            </p>
            <p className="mt-1 whitespace-pre-line text-ink-muted">{c.content.slice(c.content.indexOf('\n') + 1)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
