import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { Link } from 'react-router'
import { buttonStyles, ErrorState } from '@/components/Bits'
import { ProductCard } from '@/components/ProductCard'
import { api } from '@/lib/api'
import type { ProductSummary } from '@/lib/types'

export function WishlistPage() {
  const list = useQuery({ queryKey: ['wishlist'], queryFn: () => api<ProductSummary[]>('/api/wishlist') })

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Wishlist</h1>
      {list.isPending && <p className="mt-4 text-sm text-ink-muted">Loading…</p>}
      {list.isError && (
        <div className="mt-4">
          <ErrorState title="Couldn’t load your wishlist" detail={list.error.message} onRetry={() => list.refetch()} />
        </div>
      )}
      {list.data?.length === 0 && (
        <div className="mx-auto max-w-md py-12 text-center">
          <Heart className="mx-auto size-10 text-ink-subtle" strokeWidth={1.4} aria-hidden />
          <p className="mt-3 font-semibold">Nothing saved yet</p>
          <p className="mt-1 text-sm text-ink-muted">Tap the heart on any product to keep it here.</p>
          <Link to="/" className={`${buttonStyles.secondary} mt-5`}>
            Browse products
          </Link>
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {list.data.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
