import { BookOpen, Headphones, HeartPulse, Laptop, Package, Refrigerator, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { Specs } from '@/lib/types'

interface Props {
  src: string | null | undefined
  name: string
  brand: string
  specs: Specs
  className?: string
  size?: 'card' | 'hero' | 'thumb'
}

const bookPalettes = [
  ['#1d3557', '#f1faee'],
  ['#3d2c8d', '#fdf6ec'],
  ['#7f1d1d', '#fef3c7'],
  ['#14532d', '#ecfccb'],
  ['#1f2937', '#fde68a'],
  ['#9a3412', '#fff7ed'],
]

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Product photo, or a designed stand-in for catalogue items that ship without photography:
 * typographic covers for books, a category glyph with the brand for everything else.
 */
export function ProductImage({ src, name, brand, specs, className, size = 'card' }: Props) {
  const [failed, setFailed] = useState(false)

  if (src && !failed) {
    return (
      <div className={cn('grid place-items-center overflow-hidden bg-white', className)}>
        <img
          src={src}
          alt={name}
          loading={size === 'hero' ? 'eager' : 'lazy'}
          onError={() => setFailed(true)}
          className="size-full object-contain p-[6%] mix-blend-multiply"
        />
      </div>
    )
  }

  if (specs.type === 'Book') {
    const [bg, fg] = bookPalettes[hash(name) % bookPalettes.length]
    return (
      <div className={cn('grid place-items-center overflow-hidden bg-[#f3f2ee] p-[10%]', className)} role="img" aria-label={name}>
        <div
          className="flex aspect-[2/3] h-full max-h-full min-h-0 flex-col overflow-hidden justify-between rounded-[3px] p-[8%] shadow-[4px_6px_14px_rgba(0,0,0,0.18)]"
          style={{ background: bg, color: fg }}
        >
          <span
            className={cn('font-semibold leading-tight', size === 'thumb' ? 'text-[6px]' : size === 'hero' ? 'text-2xl' : 'text-sm')}
          >
            {name}
          </span>
          <span className={cn('opacity-80', size === 'thumb' ? 'text-[5px]' : size === 'hero' ? 'text-base' : 'text-[11px]')}>
            {String(specs.author ?? brand)}
          </span>
        </div>
      </div>
    )
  }

  const Icon =
    specs.type === 'Laptop'
      ? Laptop
      : specs.type === 'Smartphone'
        ? Smartphone
        : specs.type === 'Audio'
          ? Headphones
          : specs.type === 'Appliance'
            ? Refrigerator
            : specs.type === 'Health device'
              ? HeartPulse
              : specs.type === 'Book'
                ? BookOpen
                : Package

  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-[#f6f5f2] to-[#ebe9e3]', className)}
      role="img"
      aria-label={name}
    >
      <Icon
        className={cn('text-ink/70', size === 'hero' ? 'size-28' : size === 'thumb' ? 'size-5' : 'size-14')}
        strokeWidth={1.1}
        aria-hidden
      />
      {size !== 'thumb' && (
        <span className={cn('font-semibold uppercase tracking-[0.18em] text-ink/55', size === 'hero' ? 'text-sm' : 'text-[10px]')}>
          {brand}
        </span>
      )}
    </div>
  )
}
