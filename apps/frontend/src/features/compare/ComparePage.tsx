import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorState, Price, Rating, StockBadge } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { useCompare } from '@/features/compare/compareStore'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatSpec, sortSpecKeys, specLabel } from '@/lib/format'
import type { ProductSummary } from '@/lib/types'

/** Specs where a higher number is better; used to mark the best value per row. */
const higherIsBetter = new Set(['ramGb', 'storageGb', 'batteryHours', 'batteryMah', 'mainCameraMp', 'refreshHz', 'capacityLitres'])
const lowerIsBetter = new Set(['weightKg'])

export function ComparePage() {
  const [params, setParams] = useSearchParams()
  const removeFromTray = useCompare((s) => s.remove)
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean)

  const query = useQuery({
    queryKey: ['compare', ids.join(',')],
    queryFn: () => api<ProductSummary[]>(`/api/catalog/compare?ids=${ids.join(',')}`),
    enabled: ids.length >= 2,
  })

  if (ids.length < 2) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState title="Pick at least two products to compare" detail="Use the Compare checkbox on any product card." />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState title="Couldn’t load the comparison" detail={query.error.message} onRetry={() => query.refetch()} />
      </div>
    )
  }
  const products = query.data ?? []

  const specKeys = sortSpecKeys([...new Set(products.flatMap((p) => Object.keys(p.specs)))]).filter((k) => k !== 'type')
  const rows = specKeys
    .map((key) => {
      const values = products.map((p) => p.specs[key])
      const same = values.every((v) => String(v) === String(values[0]))
      return { key, values, same, best: bestIndex(key, values) }
    })
    .filter((r) => !onlyDifferences || !r.same)

  function remove(id: string) {
    removeFromTray(id)
    const rest = ids.filter((x) => x !== id)
    setParams(rest.length ? { ids: rest.join(',') } : {})
  }

  const cols = `minmax(140px,180px) repeat(${Math.max(products.length, 2)}, minmax(170px,1fr))`

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Compare products</h1>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyDifferences}
            onChange={(e) => setOnlyDifferences(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Show only differences
        </label>
      </div>

      <div className="mt-5 overflow-x-auto rounded-card border border-line bg-surface">
        <div className="min-w-max">
          <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
            <div />
            {products.map((p) => (
              <div key={p.id} className="relative border-l border-line p-4">
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  aria-label={`Remove ${p.name}`}
                  className="absolute right-2 top-2 rounded p-1 text-ink-muted hover:bg-canvas hover:text-ink"
                >
                  <X className="size-4" />
                </button>
                <Link to={`/p/${p.slug}`}>
                  <ProductImage src={p.image} name={p.name} brand={p.brand} specs={p.specs} className="mx-auto aspect-square w-32 rounded-md" />
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{p.brand}</p>
                  <p className="line-clamp-2 text-sm font-medium hover:text-accent">{p.name}</p>
                </Link>
                <div className="mt-2">
                  <Price price={p.price} mrp={p.mrp} currency={p.currency} />
                </div>
                <Rating value={p.rating} count={p.ratingCount} className="mt-1" />
                <StockBadge availability={p.availability} className="mt-1 block" />
              </div>
            ))}
          </div>

          {rows.map((row) => (
            <div key={row.key} className="grid border-b border-line text-sm last:border-0" style={{ gridTemplateColumns: cols }}>
              <div className="bg-canvas/60 px-4 py-2.5 text-ink-muted">{specLabel(row.key)}</div>
              {row.values.map((v, i) => (
                <div
                  key={products[i].id}
                  className={cn(
                    'border-l border-line px-4 py-2.5',
                    !row.same && 'font-medium',
                    row.best === i && 'bg-[#eaf6ee] text-stock-in',
                  )}
                >
                  {formatSpec(row.key, v)}
                </div>
              ))}
            </div>
          ))}
          {rows.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">These products have identical specifications.</p>}
        </div>
      </div>
    </div>
  )
}

function bestIndex(key: string, values: unknown[]): number {
  if (!higherIsBetter.has(key) && !lowerIsBetter.has(key)) return -1
  const nums = values.map((v) => (typeof v === 'number' ? v : Number.NaN))
  const valid = nums.filter((n) => !Number.isNaN(n))
  if (valid.length < 2 || new Set(valid).size === 1) return -1
  const target = higherIsBetter.has(key) ? Math.max(...valid) : Math.min(...valid)
  return nums.filter((n) => n === target).length === 1 ? nums.indexOf(target) : -1
}
