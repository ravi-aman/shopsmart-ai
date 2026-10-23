import { X } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { ProductImage } from '@/components/ProductImage'
import { MAX_COMPARE, useCompare } from '@/features/compare/compareStore'

/** Floating bar listing the products picked for comparison. */
export function CompareTray() {
  const items = useCompare((s) => s.items)
  const remove = useCompare((s) => s.remove)
  const clear = useCompare((s) => s.clear)
  const location = useLocation()

  if (items.length === 0 || location.pathname === '/compare') return null
  const mixed = new Set(items.map((i) => i.categorySlug)).size > 1

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 shadow-[0_-6px_24px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <p className="text-sm font-semibold">
          Compare <span className="text-ink-subtle">({items.length}/{MAX_COMPARE})</span>
        </p>
        <ul className="flex flex-1 gap-2 overflow-x-auto">
          {items.map((i) => (
            <li key={i.id} className="flex shrink-0 items-center gap-2 rounded-md border border-line py-1 pl-1 pr-2 text-xs">
              <ProductImage src={i.image} name={i.name} brand="" specs={{}} size="thumb" className="size-8 rounded" />
              <span className="max-w-[140px] truncate">{i.name}</span>
              <button type="button" onClick={() => remove(i.id)} aria-label={`Remove ${i.name} from compare`}>
                <X className="size-3.5 text-ink-muted hover:text-ink" />
              </button>
            </li>
          ))}
        </ul>
        {mixed && <p className="text-xs text-stock-low">Products are from different categories</p>}
        <button type="button" onClick={clear} className="text-sm text-ink-muted hover:text-ink">
          Clear
        </button>
        <Link
          to={`/compare?ids=${items.map((i) => i.id).join(',')}`}
          aria-disabled={items.length < 2}
          className={
            items.length < 2
              ? 'pointer-events-none rounded-md bg-ink/30 px-4 py-2 text-sm font-semibold text-white'
              : 'rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/85'
          }
        >
          {items.length < 2 ? 'Add one more' : 'Compare now'}
        </Link>
      </div>
    </div>
  )
}
