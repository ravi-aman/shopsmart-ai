import { Star } from 'lucide-react'
import { availabilityLabel, discountPercent, formatPrice } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Availability } from '@/lib/types'

export function Rating({ value, count, className }: { value: number; count?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-ink-muted', className)}>
      <span className="inline-flex items-center gap-0.5 rounded bg-stock-in px-1.5 py-0.5 font-semibold text-white">
        {value.toFixed(1)}
        <Star className="size-3 fill-current" aria-hidden />
      </span>
      {count !== undefined && <span>({count.toLocaleString('en-US')})</span>}
      <span className="sr-only">rated {value} out of 5</span>
    </span>
  )
}

export function StockBadge({ availability, className }: { availability: Availability; className?: string }) {
  return (
    <span
      className={cn(
        'text-xs font-medium',
        availability === 'IN_STOCK' && 'text-stock-in',
        availability === 'LOW_STOCK' && 'text-stock-low',
        availability === 'OUT_OF_STOCK' && 'text-stock-out',
        className,
      )}
    >
      {availabilityLabel[availability]}
    </span>
  )
}

export function Price({
  price,
  mrp,
  currency,
  size = 'md',
}: {
  price: number
  mrp: number | null
  currency: string
  size?: 'md' | 'lg'
}) {
  const off = discountPercent(price, mrp)
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-3xl' : 'text-lg')}>
        {formatPrice(price, currency)}
      </span>
      {off > 0 && mrp && (
        <>
          <span className="text-sm text-ink-subtle line-through">{formatPrice(mrp, currency)}</span>
          <span className="text-sm font-medium text-stock-in">{off}% off</span>
        </>
      )}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      aria-hidden
    />
  )
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center">
      <p className="font-semibold">{title}</p>
      {detail && <p className="mt-1 text-sm text-ink-muted">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-canvas"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export const buttonStyles = {
  primary:
    'inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50',
  dark: 'inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50',
}
