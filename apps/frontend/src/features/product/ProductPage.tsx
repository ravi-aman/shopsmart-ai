import { useQuery } from '@tanstack/react-query'
import { Check, GitCompareArrows, Heart, MapPin, Minus, Plus, ShieldCheck, Sparkles, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { buttonStyles, ErrorState, Price, Rating, Spinner, StockBadge } from '@/components/Bits'
import { ProductCard } from '@/components/ProductCard'
import { ProductImage } from '@/components/ProductImage'
import { useAssistant } from '@/features/assistant/assistantStore'
import { useAuth } from '@/features/auth/authStore'
import { MAX_QUANTITY, useCart } from '@/features/cart/useCart'
import { useCompare } from '@/features/compare/compareStore'
import { useWishlist } from '@/features/wishlist/useWishlist'
import { NotifyMe, PremiumTools } from '@/features/product/ProductExtras'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatSpec, regionLabel, sortSpecKeys, specLabel } from '@/lib/format'
import type { ProductDetail } from '@/lib/types'

export function ProductPage() {
  const { slug = '' } = useParams()
  const detail = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api<ProductDetail>(`/api/catalog/products/${encodeURIComponent(slug)}`),
  })

  if (detail.isPending) {
    return (
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 md:grid-cols-2" aria-busy>
        <div className="aspect-square animate-pulse rounded-card bg-surface" />
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-surface" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-surface" />
          <div className="h-6 w-32 animate-pulse rounded bg-surface" />
        </div>
      </div>
    )
  }
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.problem.status === 404
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState
          title={notFound ? 'Product not found' : 'Couldn’t load this product'}
          detail={notFound ? 'It may have been removed from the catalogue.' : detail.error.message}
          onRetry={notFound ? undefined : () => detail.refetch()}
        />
      </div>
    )
  }

  return <ProductView key={detail.data.product.id} detail={detail.data} />
}

function ProductView({ detail }: { detail: ProductDetail }) {
  const { product: p, images } = detail
  const [activeImage, setActiveImage] = useState(0)
  const specs = sortSpecKeys(Object.keys(p.specs))
    .filter((k) => k !== 'type')
    .map((k) => [k, p.specs[k]] as const)

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav className="mb-4 text-xs text-ink-subtle" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink">
          Home
        </Link>
        {detail.breadcrumbs.map((b) => (
          <span key={b.slug}>
            {' / '}
            <Link to={`/c/${b.slug}`} className="hover:text-ink">
              {b.name}
            </Link>
          </span>
        ))}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr_340px]">
        {/* gallery */}
        <div className="flex flex-col-reverse gap-3 md:flex-row lg:col-span-1">
          {images.length > 1 && (
            <ul className="flex gap-2 md:flex-col">
              {images.map((src, i) => (
                <li key={src}>
                  <button
                    type="button"
                    onClick={() => setActiveImage(i)}
                    aria-label={`Show image ${i + 1}`}
                    className={cn(
                      'block size-16 overflow-hidden rounded-md border-2 bg-white',
                      i === activeImage ? 'border-accent' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <img src={src} alt="" className="size-full object-contain p-1" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ProductImage
            src={images[activeImage] ?? p.image}
            name={p.name}
            brand={p.brand}
            specs={p.specs}
            size="hero"
            className="aspect-square flex-1 rounded-card border border-line"
          />
        </div>

        {/* info */}
        <div>
          <Link to={`/search?q=${encodeURIComponent(p.brand)}`} className="text-sm font-semibold text-accent hover:underline">
            {p.brand}
          </Link>
          <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight md:text-3xl">{p.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <Rating value={p.rating} count={p.ratingCount} />
            <span className="text-xs text-ink-subtle">SKU {p.id}</span>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <Price price={p.price} mrp={p.mrp} currency={p.currency} size="lg" />
            <p className="mt-0.5 text-xs text-ink-subtle">Inclusive of all taxes</p>
          </div>
          <p className="mt-5 leading-relaxed text-ink-muted">{detail.description}</p>

          {specs.length > 0 && (
            <section className="mt-6">
              <h2 className="text-lg font-semibold">Specifications</h2>
              <dl className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface text-sm">
                {specs.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[42%_1fr] gap-3 px-4 py-2.5">
                    <dt className="text-ink-muted">{specLabel(key)}</dt>
                    <dd className="font-medium">{formatSpec(key, value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <PremiumTools detail={detail} />
        </div>

        {/* buy box */}
        <BuyBox detail={detail} />
      </div>

      {detail.related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold">Similar products</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
            {detail.related.slice(0, 5).map((r) => (
              <li key={r.id}>
                <ProductCard product={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function BuyBox({ detail }: { detail: ProductDetail }) {
  const { product: p } = detail
  const user = useAuth((s) => s.user)
  const cart = useCart()
  const wishlist = useWishlist()
  const compareItems = useCompare((s) => s.items)
  const toggleCompare = useCompare((s) => s.toggle)
  const navigate = useNavigate()
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const region = user?.region ?? 'IN-WEST'
  const local = detail.stockByWarehouse.filter((w) => w.region === region && w.available > 0)
  const anywhere = detail.stockByWarehouse.filter((w) => w.available > 0)
  const days = local.length > 0 ? 2 : 4
  const deliveryDate = new Date(now + days * 86_400_000).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
  const inCart = cart.quantityOf(p.id)
  const maxQty = Math.max(1, Math.min(MAX_QUANTITY, p.availableQuantity - inCart))
  const outOfStock = p.availability === 'OUT_OF_STOCK'
  const canAdd = !outOfStock && inCart + qty <= p.availableQuantity

  async function addToCart(goToCart: boolean) {
    setError(null)
    try {
      await cart.setQuantity(p.id, Math.min(inCart + qty, MAX_QUANTITY))
      setAdded(true)
      if (goToCart) navigate('/cart')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to cart')
    }
  }

  return (
    <aside className="h-fit rounded-card border border-line bg-surface p-5 lg:sticky lg:top-32">
      <Price price={p.price} mrp={p.mrp} currency={p.currency} />
      {detail.promotion && (
        <p className="mt-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent">
          Extra {detail.promotion.percent}% off at checkout · {detail.promotion.code}
        </p>
      )}
      <StockBadge availability={p.availability} className="mt-2 block text-sm" />

      {!outOfStock && (
        <div className="mt-4 space-y-2 text-sm">
          <p className="flex gap-2">
            <Truck className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <span>
              Delivery by <strong>{deliveryDate}</strong>
              <span className="block text-xs text-ink-subtle">
                {local.length > 0
                  ? `Ships from ${local[0].city} (${regionLabel[region] ?? region})`
                  : `Ships from ${anywhere[0]?.city ?? 'another region'}`}
              </span>
            </span>
          </p>
          <p className="flex gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <span>
              In stock at {anywhere.length} of {detail.stockByWarehouse.length} fulfilment centres
            </span>
          </p>
        </div>
      )}

      {!outOfStock && (
        <div className="mt-5 flex items-center gap-3">
          <span className="text-sm text-ink-muted">Qty</span>
          <div className="inline-flex items-center rounded-md border border-line-strong">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
              className="grid size-9 place-items-center disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty >= maxQty}
              aria-label="Increase quantity"
              className="grid size-9 place-items-center disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
          {inCart > 0 && <span className="text-xs text-ink-muted">{inCart} in cart</span>}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <button type="button" className={buttonStyles.primary} disabled={!canAdd || cart.isUpdating} onClick={() => addToCart(false)}>
          {cart.isUpdating ? <Spinner /> : added ? <Check className="size-4" aria-hidden /> : null}
          {outOfStock ? 'Currently unavailable' : added ? 'Added to cart' : 'Add to cart'}
        </button>
        {!outOfStock && (
          <button type="button" className={buttonStyles.dark} disabled={!canAdd || cart.isUpdating} onClick={() => addToCart(true)}>
            Buy now
          </button>
        )}
        {outOfStock && <NotifyMe productId={p.id} />}
        {!canAdd && !outOfStock && <p className="text-xs text-stock-low">You already have all available units in your cart.</p>}
        {error && <p className="text-xs text-stock-out">{error}</p>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => wishlist.toggle(p.id)} className={cn(buttonStyles.secondary, 'px-2')}>
          <Heart className={cn('size-4', wishlist.has(p.id) && 'fill-stock-out text-stock-out')} aria-hidden />
          {wishlist.has(p.id) ? 'Saved' : 'Wishlist'}
        </button>
        <button
          type="button"
          onClick={() => toggleCompare({ id: p.id, name: p.name, image: p.image, categorySlug: p.categorySlug })}
          className={cn(buttonStyles.secondary, 'px-2', compareItems.some((i) => i.id === p.id) && 'border-ink')}
        >
          <GitCompareArrows className="size-4" aria-hidden />
          {compareItems.some((i) => i.id === p.id) ? 'Comparing' : 'Compare'}
        </button>
      </div>

      <AskAboutProduct id={p.id} name={p.name} categoryName={p.categoryName} />
    </aside>
  )
}

/** Policy questions scoped to this product; answers come from approved documents with citations. */
function AskAboutProduct({ id, name, categoryName }: { id: string; name: string; categoryName: string }) {
  const ask = useAssistant((s) => s.ask)
  const noun = categoryName.toLowerCase().replace(/s$/, '')
  const questions = [`What is the warranty on this ${noun}?`, `Can I return this ${noun} if opened?`, 'Can I cancel after it ships?']
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <ShieldCheck className="size-4 text-ink-muted" aria-hidden />
        Returns, warranty & delivery
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">Answered from ShopSmart policy documents, with the source.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(q, { id, name })}
            className="inline-flex items-center gap-1 rounded-full border border-ai/30 bg-ai-soft px-2.5 py-1 text-xs font-medium text-ai hover:bg-ai hover:text-white"
          >
            <Sparkles className="size-3" aria-hidden />
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
