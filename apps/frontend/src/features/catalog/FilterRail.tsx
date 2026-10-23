import { Star, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { formatFacetValue } from '@/lib/format'
import type { Facet, SearchResponse } from '@/lib/types'

interface Props {
  facets: SearchResponse['facets'] | undefined
  params: URLSearchParams
  update: (mutator: (p: URLSearchParams) => void) => void
  open: boolean
  onClose: () => void
}

export function FilterRail({ facets, params, update, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const list = facets?.facets ?? []
  const categoryFacet = list.find((f) => f.key === 'category')
  const brandFacet = list.find((f) => f.key === 'brand')
  const specFacets = list.filter((f) => f.key.startsWith('spec.'))
  const stockFacet = list.find((f) => f.key === 'availability')

  const content = (
    <div className="space-y-6 text-sm">
      {categoryFacet && (
        <FacetSection title="Category">
          <ul className="space-y-1">
            {categoryFacet.values.map((v) => (
              <li key={v.value}>
                <Link to={`/c/${v.value}?${params.toString()}`} className="flex justify-between gap-2 hover:text-accent">
                  <span>{v.label}</span>
                  <span className="text-ink-subtle">{v.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </FacetSection>
      )}

      <PriceFilter
        key={`${params.get('minPrice')}-${params.get('maxPrice')}`}
        params={params}
        update={update}
        range={facets?.price}
      />

      <FacetSection title="Customer rating">
        <div className="flex flex-col gap-1">
          {['4', '3'].map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="minRating"
                checked={params.get('minRating') === r}
                onChange={() => update((p) => p.set('minRating', r))}
                className="accent-[var(--color-accent)]"
              />
              <span className="inline-flex items-center gap-1">
                {r}
                <Star className="size-3.5 fill-current text-stock-low" aria-hidden /> & up
              </span>
            </label>
          ))}
        </div>
      </FacetSection>

      {stockFacet && (
        <FacetSection title="Availability">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={params.get('inStock') === 'true'}
              onChange={(e) => update((p) => (e.target.checked ? p.set('inStock', 'true') : p.delete('inStock')))}
              className="accent-[var(--color-accent)]"
            />
            In stock only <span className="text-ink-subtle">({stockFacet.values[0]?.count ?? 0})</span>
          </label>
        </FacetSection>
      )}

      {brandFacet && <CheckboxFacet facet={brandFacet} paramKey="brand" params={params} update={update} />}
      {specFacets.map((f) => (
        <CheckboxFacet key={f.key} facet={f} paramKey={f.key} params={params} update={update} />
      ))}
    </div>
  )

  return (
    <>
      <aside className="hidden lg:block" aria-label="Filters">
        {content}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close filters" />
          <div className="absolute inset-y-0 left-0 flex w-[min(340px,88vw)] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-semibold">Filters</p>
              <button type="button" onClick={onClose} aria-label="Close filters" className="rounded p-1 hover:bg-canvas">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{content}</div>
            <div className="border-t border-line p-3">
              <button type="button" onClick={onClose} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white">
                Show results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FacetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{title}</h2>
      {children}
    </section>
  )
}

function CheckboxFacet({
  facet,
  paramKey,
  params,
  update,
}: {
  facet: Facet
  paramKey: string
  params: URLSearchParams
  update: Props['update']
}) {
  const [expanded, setExpanded] = useState(false)
  const selected = new Set(params.getAll(paramKey))
  const values = expanded ? facet.values : facet.values.slice(0, 8)

  return (
    <FacetSection title={facet.label}>
      <ul className="space-y-1">
        {values.map((v) => (
          <li key={v.value}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(v.value)}
                onChange={(e) =>
                  update((p) => {
                    const rest = p.getAll(paramKey).filter((x) => x !== v.value)
                    p.delete(paramKey)
                    rest.forEach((x) => p.append(paramKey, x))
                    if (e.target.checked) p.append(paramKey, v.value)
                  })
                }
                className="accent-[var(--color-accent)]"
              />
              <span className="flex-1 truncate">{formatFacetValue(paramKey, v.label)}</span>
              <span className="text-ink-subtle">{v.count}</span>
            </label>
          </li>
        ))}
      </ul>
      {facet.values.length > 8 && (
        <button type="button" onClick={() => setExpanded((x) => !x)} className="mt-1.5 text-xs font-medium text-accent hover:underline">
          {expanded ? 'Show less' : `Show all ${facet.values.length}`}
        </button>
      )}
    </FacetSection>
  )
}

function PriceFilter({
  params,
  update,
  range,
}: {
  params: URLSearchParams
  update: Props['update']
  range: { min: number | null; max: number | null } | undefined
}) {
  const [min, setMin] = useState(params.get('minPrice') ?? '')
  const [max, setMax] = useState(params.get('maxPrice') ?? '')

  const invalid = min !== '' && max !== '' && Number(min) > Number(max)

  return (
    <FacetSection title="Price">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (invalid) return
          update((p) => {
            if (min) p.set('minPrice', min)
            else p.delete('minPrice')
            if (max) p.set('maxPrice', max)
            else p.delete('maxPrice')
          })
        }}
      >
        <input
          type="number"
          min={0}
          inputMode="decimal"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          placeholder={range?.min != null ? `$${Math.floor(range.min)}` : 'Min'}
          aria-label="Minimum price"
          className={cn('w-full min-w-0 rounded-md border border-line-strong px-2 py-1.5', invalid && 'border-stock-out')}
        />
        <span className="text-ink-subtle">–</span>
        <input
          type="number"
          min={0}
          inputMode="decimal"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          placeholder={range?.max != null ? `$${Math.ceil(range.max)}` : 'Max'}
          aria-label="Maximum price"
          className={cn('w-full min-w-0 rounded-md border border-line-strong px-2 py-1.5', invalid && 'border-stock-out')}
        />
        <button type="submit" disabled={invalid} className="rounded-md border border-line-strong px-2.5 py-1.5 font-medium hover:bg-canvas disabled:opacity-50">
          Go
        </button>
      </form>
      {invalid && <p className="mt-1 text-xs text-stock-out">Minimum is higher than maximum</p>}
    </FacetSection>
  )
}
