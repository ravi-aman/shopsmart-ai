import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ErrorState } from '@/components/Bits'
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard'
import { FilterRail } from '@/features/catalog/FilterRail'
import { Pagination } from '@/features/catalog/Pagination'
import { api, ApiError } from '@/lib/api'
import { formatFacetValue, formatPrice } from '@/lib/format'
import type { CategoryNode, SearchResponse } from '@/lib/types'

const PAGE_SIZE = 24

const sortOptions = [
  ['relevance', 'Relevance'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['rating', 'Customer rating'],
  ['newest', 'Newest'],
] as const

/** Category listing (/c/:slug) and search results (/search?q=). Every filter lives in the URL. */
export function ListingPage() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const q = params.get('q') ?? ''

  const apiParams = new URLSearchParams(params)
  if (slug) apiParams.set('category', slug)
  apiParams.set('size', String(PAGE_SIZE))
  const queryString = apiParams.toString()

  const results = useQuery({
    queryKey: ['products', queryString],
    queryFn: () => api<SearchResponse>(`/api/catalog/products?${queryString}`),
    placeholderData: (prev) => prev,
  })

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<CategoryNode[]>('/api/catalog/categories'),
    staleTime: 5 * 60_000,
  })
  const category = slug ? findCategory(categories.data ?? [], slug) : null

  function update(mutator: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    mutator(next)
    next.delete('page')
    setParams(next)
  }

  const activeChips = activeFilters(params)
  const title = q ? `Results for “${q}”` : (category?.name ?? 'All products')

  if (results.isError) {
    const notFound = results.error instanceof ApiError && results.error.problem.status === 404
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <ErrorState
          title={notFound ? 'This category doesn’t exist' : 'Couldn’t load products'}
          detail={results.error.message}
          onRetry={notFound ? undefined : () => results.refetch()}
        />
      </div>
    )
  }

  const data = results.data
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {category && (
            <nav className="mb-1 text-xs text-ink-subtle" aria-label="Breadcrumb">
              <Link to="/" className="hover:text-ink">
                Home
              </Link>
              {category.path.split('/').map((s) => (
                <span key={s}>
                  {' / '}
                  <Link to={`/c/${s}`} className="hover:text-ink">
                    {findCategory(categories.data ?? [], s)?.name ?? s}
                  </Link>
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {data ? `${data.totalItems.toLocaleString('en-US')} ${data.totalItems === 1 ? 'product' : 'products'}` : ' '}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters{activeChips.length > 0 && ` (${activeChips.length})`}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span className="hidden text-ink-muted sm:inline">Sort by</span>
            <select
              value={params.get('sort') ?? 'relevance'}
              onChange={(e) => update((p) => (e.target.value === 'relevance' ? p.delete('sort') : p.set('sort', e.target.value)))}
              className="rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm"
            >
              {sortOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {category && category.children.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {category.children.map((c) => (
            <Link
              key={c.slug}
              to={`/c/${c.slug}`}
              className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-ink"
            >
              {c.name} <span className="text-ink-subtle">{c.productCount}</span>
            </Link>
          ))}
        </div>
      )}

      {activeChips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.key + chip.value}
              type="button"
              onClick={() => update(chip.remove)}
              className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white hover:bg-ink/80"
            >
              {chip.label}
              <X className="size-3" aria-label="remove filter" />
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              update((p) => {
                for (const key of [...p.keys()]) if (key !== 'q' && key !== 'sort') p.delete(key)
              })
            }
            className="text-xs font-medium text-accent hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[250px_1fr]">
        <FilterRail
          facets={data?.facets}
          params={params}
          update={update}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        />

        <section aria-live="polite" aria-busy={results.isFetching}>
          {!data ? (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i}>
                  <ProductCardSkeleton />
                </li>
              ))}
            </ul>
          ) : data.items.length === 0 ? (
            <div className="rounded-card border border-line bg-surface p-10 text-center">
              <p className="font-semibold">No products match these filters</p>
              <p className="mt-1 text-sm text-ink-muted">Try removing a filter or searching for something broader.</p>
            </div>
          ) : (
            <>
              <ul className={`grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 ${results.isFetching ? 'opacity-60' : ''}`}>
                {data.items.map((p) => (
                  <li key={p.id}>
                    <ProductCard product={p} />
                  </li>
                ))}
              </ul>
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                onChange={(page) => {
                  const next = new URLSearchParams(params)
                  if (page === 0) next.delete('page')
                  else next.set('page', String(page))
                  setParams(next)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export function findCategory(nodes: CategoryNode[], slug: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.slug === slug) return n
    const found = findCategory(n.children, slug)
    if (found) return found
  }
  return null
}

interface Chip {
  key: string
  value: string
  label: string
  remove: (p: URLSearchParams) => void
}

function activeFilters(params: URLSearchParams): Chip[] {
  const chips: Chip[] = []
  for (const [key, value] of params) {
    if (key === 'brand' || key.startsWith('spec.')) {
      chips.push({
        key,
        value,
        label: formatFacetValue(key, value),
        remove: (p) => {
          const rest = p.getAll(key).filter((v) => v !== value)
          p.delete(key)
          rest.forEach((v) => p.append(key, v))
        },
      })
    }
  }
  const min = params.get('minPrice')
  const max = params.get('maxPrice')
  if (min || max) {
    chips.push({
      key: 'price',
      value: `${min}-${max}`,
      label: `${min ? formatPrice(Number(min)) : 'Any'} – ${max ? formatPrice(Number(max)) : 'Any'}`,
      remove: (p) => {
        p.delete('minPrice')
        p.delete('maxPrice')
      },
    })
  }
  if (params.get('minRating')) {
    chips.push({ key: 'minRating', value: '', label: `${params.get('minRating')}★ & up`, remove: (p) => p.delete('minRating') })
  }
  if (params.get('inStock') === 'true') {
    chips.push({ key: 'inStock', value: '', label: 'In stock', remove: (p) => p.delete('inStock') })
  }
  return chips
}
