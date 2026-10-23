import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Zero-based page numbers with first/last and a window around the current page. */
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null
  const pages = new Set([0, totalPages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < totalPages))
  const sorted = [...pages].sort((a, b) => a - b)

  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Pagination">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface disabled:opacity-40"
      >
        <ChevronLeft className="size-4" aria-hidden /> Previous
      </button>
      {sorted.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && p - sorted[i - 1] > 1 && <span className="px-1 text-ink-subtle">…</span>}
          <button
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              'min-w-9 rounded-md px-3 py-2 text-sm font-medium',
              p === page ? 'bg-ink text-white' : 'hover:bg-surface',
            )}
          >
            {p + 1}
          </button>
        </span>
      ))}
      <button
        type="button"
        disabled={page >= totalPages - 1}
        onClick={() => onChange(page + 1)}
        className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface disabled:opacity-40"
      >
        Next <ChevronRight className="size-4" aria-hidden />
      </button>
    </nav>
  )
}
