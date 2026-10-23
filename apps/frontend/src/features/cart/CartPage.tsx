import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { buttonStyles, StockBadge } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { useAuth } from '@/features/auth/authStore'
import { MAX_QUANTITY, useCart } from '@/features/cart/useCart'
import { formatPrice } from '@/lib/format'

export function CartPage() {
  const token = useAuth((s) => s.token)
  const { cart, isLoading, setQuantity, isUpdating } = useCart()
  const [error, setError] = useState<string | null>(null)

  async function change(productId: string, quantity: number) {
    setError(null)
    try {
      await setQuantity(productId, quantity)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update cart')
    }
  }

  if (isLoading) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-ink-muted">Loading your cart…</div>
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <ShoppingCart className="mx-auto size-10 text-ink-subtle" strokeWidth={1.4} aria-hidden />
        <h1 className="mt-3 text-xl font-bold">Your cart is empty</h1>
        <p className="mt-1 text-sm text-ink-muted">Browse departments or ask the assistant for a recommendation.</p>
        <Link to="/" className={`${buttonStyles.primary} mt-6`}>
          Continue shopping
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Shopping cart</h1>
      {!token && (
        <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-sm">
          <Link to="/login?next=/cart" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>{' '}
          to save your cart and check out. Items you add now will move to your account.
        </p>
      )}
      {error && <p className="mt-2 rounded-md bg-[#fdecec] px-3 py-2 text-sm text-stock-out">{error}</p>}

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {cart.items.map(({ product: p, quantity, lineTotal }) => (
            <li key={p.id} className="flex gap-4 p-4">
              <Link to={`/p/${p.slug}`} className="shrink-0">
                <ProductImage src={p.image} name={p.name} brand={p.brand} specs={p.specs} className="size-24 rounded-md border border-line" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link to={`/p/${p.slug}`} className="line-clamp-2 font-medium hover:text-accent">
                  {p.name}
                </Link>
                <StockBadge availability={p.availability} />
                <p className="text-sm text-ink-muted">{formatPrice(p.price, p.currency)} each</p>
                <div className="mt-auto flex items-center gap-3 pt-1">
                  <div className="inline-flex items-center rounded-md border border-line-strong">
                    <button
                      type="button"
                      disabled={isUpdating || quantity <= 1}
                      onClick={() => change(p.id, quantity - 1)}
                      aria-label="Decrease quantity"
                      className="grid size-8 place-items-center disabled:opacity-40"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                    <button
                      type="button"
                      disabled={isUpdating || quantity >= Math.min(MAX_QUANTITY, p.availableQuantity)}
                      onClick={() => change(p.id, quantity + 1)}
                      aria-label="Increase quantity"
                      className="grid size-8 place-items-center disabled:opacity-40"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => change(p.id, 0)}
                    className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-stock-out"
                  >
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </button>
                </div>
              </div>
              <p className="shrink-0 font-semibold">{formatPrice(lineTotal, p.currency)}</p>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-card border border-line bg-surface p-5 lg:sticky lg:top-32">
          <h2 className="font-semibold">Order summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Items ({cart.itemCount})</dt>
              <dd>{formatPrice(cart.subtotal)}</dd>
            </div>
            {cart.savings > 0 && (
              <div className="flex justify-between text-stock-in">
                <dt>You save</dt>
                <dd>{formatPrice(cart.savings)}</dd>
              </div>
            )}
            <div className="flex justify-between text-ink-muted">
              <dt>Shipping</dt>
              <dd>Calculated at checkout</dd>
            </div>
          </dl>
          <div className="mt-3 flex justify-between border-t border-line pt-3 font-semibold">
            <span>Subtotal</span>
            <span>{formatPrice(cart.subtotal)}</span>
          </div>
          <Link to={token ? '/checkout' : '/login?next=/checkout'} className={`${buttonStyles.primary} mt-4 w-full`}>
            Proceed to checkout
          </Link>
          <p className="mt-2 text-center text-xs text-ink-subtle">Delivery fee and date are shown at checkout.</p>
        </aside>
      </div>
    </div>
  )
}
