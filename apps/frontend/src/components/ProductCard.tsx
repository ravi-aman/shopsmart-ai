import { GitCompareArrows, Heart } from 'lucide-react'
import { Link } from 'react-router'
import { Price, Rating, StockBadge } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { useCompare } from '@/features/compare/compareStore'
import { useWishlist } from '@/features/wishlist/useWishlist'
import { cn } from '@/lib/cn'
import { keySpecs } from '@/lib/format'
import type { ProductSummary } from '@/lib/types'

export function ProductCard({ product }: { product: ProductSummary }) {
  const wishlist = useWishlist()
  const compareItems = useCompare((s) => s.items)
  const toggleCompare = useCompare((s) => s.toggle)
  const inCompare = compareItems.some((i) => i.id === product.id)
  const saved = wishlist.has(product.id)
  const specs = keySpecs(product.specs)

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface transition hover:border-line-strong hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
      <Link to={`/p/${product.slug}`} className="block" aria-label={product.name}>
        <ProductImage
          src={product.image}
          name={product.name}
          brand={product.brand}
          specs={product.specs}
          className={cn('aspect-square', product.availability === 'OUT_OF_STOCK' && 'opacity-60')}
        />
      </Link>

      <button
        type="button"
        onClick={() => wishlist.toggle(product.id)}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
        className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white/90 shadow-sm ring-1 ring-line hover:bg-white"
      >
        <Heart className={cn('size-4', saved ? 'fill-stock-out text-stock-out' : 'text-ink-muted')} aria-hidden />
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{product.brand}</p>
        <Link to={`/p/${product.slug}`} className="line-clamp-2 text-sm font-medium leading-snug hover:text-accent">
          {product.name}
        </Link>
        {specs.length > 0 && <p className="line-clamp-1 text-xs text-ink-muted">{specs.join(' · ')}</p>}
        <Rating value={product.rating} count={product.ratingCount} />
        <div className="mt-auto pt-1">
          <Price price={product.price} mrp={product.mrp} currency={product.currency} />
          <div className="mt-1 flex items-center justify-between gap-2">
            <StockBadge availability={product.availability} />
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-ink-muted hover:text-ink">
              <input
                type="checkbox"
                checked={inCompare}
                onChange={() =>
                  toggleCompare({ id: product.id, name: product.name, image: product.image, categorySlug: product.categorySlug })
                }
                className="size-3.5 accent-[var(--color-accent)]"
              />
              <GitCompareArrows className="size-3.5" aria-hidden />
              Compare
            </label>
          </div>
        </div>
      </div>
    </article>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface" aria-hidden>
      <div className="aspect-square animate-pulse bg-canvas" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-1/3 animate-pulse rounded bg-canvas" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-canvas" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-canvas" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-canvas" />
      </div>
    </div>
  )
}
