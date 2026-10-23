import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Truck } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { buttonStyles, ErrorState, Spinner } from '@/components/Bits'
import { ProductImage } from '@/components/ProductImage'
import { Field, inputClass } from '@/features/auth/AuthPages'
import { useAuth } from '@/features/auth/authStore'
import { useCart } from '@/features/cart/useCart'
import { formatDay, type OrderDetail, type Quote } from '@/features/orders/types'
import { api } from '@/lib/api'
import { formatPrice, regionLabel } from '@/lib/format'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the recipient name').max(120),
  line1: z.string().trim().min(3, 'Enter the street address').max(200),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
  region: z.enum(['IN-WEST', 'IN-NORTH', 'IN-SOUTH', 'IN-EAST']),
  phone: z.string().regex(/^[0-9+ -]{8,15}$/, 'Enter a valid phone number'),
})
type FormValues = z.infer<typeof schema>

/** One-page checkout. Payment is out of scope for the brief, so placing the order reserves stock directly. */
export function CheckoutPage() {
  const user = useAuth((s) => s.user)
  const { cart, isLoading } = useCart()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.name ?? '', region: (user?.region as FormValues['region']) ?? 'IN-WEST', line1: '', city: '', pincode: '', phone: '' },
  })
  const region = useWatch({ control: form.control, name: 'region' })

  const quote = useQuery({
    queryKey: ['quote', region, cart.itemCount, cart.subtotal],
    queryFn: () => api<Quote>('/api/orders/quote', { method: 'POST', body: JSON.stringify({ region }) }),
    enabled: cart.items.length > 0,
    retry: false,
  })

  const place = useMutation({
    mutationFn: (address: FormValues) => api<OrderDetail>('/api/orders/checkout', { method: 'POST', body: JSON.stringify({ address }) }),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['cart'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      navigate(`/orders/${order.id}?placed=1`, { replace: true })
    },
  })

  if (!user) return <Navigate to="/login?next=/checkout" replace />
  if (isLoading) return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-ink-muted">Loading…</div>
  if (cart.items.length === 0 && !place.isSuccess) return <Navigate to="/cart" replace />

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px]">
        <form id="checkout" onSubmit={form.handleSubmit((v) => place.mutate(v))} noValidate className="space-y-4 rounded-card border border-line bg-surface p-5">
          <h2 className="font-semibold">Delivery address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={form.formState.errors.name?.message}>
              <input autoComplete="name" {...form.register('name')} className={inputClass} />
            </Field>
            <Field label="Phone" error={form.formState.errors.phone?.message}>
              <input autoComplete="tel" inputMode="tel" {...form.register('phone')} className={inputClass} />
            </Field>
          </div>
          <Field label="Street address" error={form.formState.errors.line1?.message}>
            <input autoComplete="address-line1" {...form.register('line1')} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" error={form.formState.errors.city?.message}>
              <input autoComplete="address-level2" {...form.register('city')} className={inputClass} />
            </Field>
            <Field label="PIN code" error={form.formState.errors.pincode?.message}>
              <input autoComplete="postal-code" inputMode="numeric" maxLength={6} {...form.register('pincode')} className={inputClass} />
            </Field>
            <Field label="Region" error={form.formState.errors.region?.message}>
              <select {...form.register('region')} className={inputClass}>
                {Object.entries(regionLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="flex items-center gap-2 rounded-md bg-canvas px-3 py-2 text-xs text-ink-muted">
            <Lock className="size-3.5" aria-hidden /> Payment is simulated in this build — placing the order reserves stock and creates the shipment.
          </p>
        </form>

        <aside className="h-fit space-y-4 rounded-card border border-line bg-surface p-5 lg:sticky lg:top-32">
          <h2 className="font-semibold">Order summary</h2>
          <ul className="space-y-3">
            {cart.items.map(({ product: p, quantity, lineTotal }) => (
              <li key={p.id} className="flex gap-3 text-sm">
                <ProductImage src={p.image} name={p.name} brand={p.brand} specs={p.specs} size="thumb" className="size-12 shrink-0 rounded border border-line" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{p.name}</span>
                  <span className="text-xs text-ink-muted">Qty {quantity}</span>
                </span>
                <span className="font-medium">{formatPrice(lineTotal, p.currency)}</span>
              </li>
            ))}
          </ul>

          {quote.isError && <ErrorState title="Can’t ship this cart" detail={quote.error.message} />}
          {quote.data && (
            <>
              <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Items</dt>
                  <dd>{formatPrice(quote.data.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Delivery</dt>
                  <dd className={quote.data.shippingFee === 0 ? 'font-medium text-stock-in' : ''}>
                    {quote.data.shippingFee === 0 ? 'FREE' : formatPrice(quote.data.shippingFee)}
                  </dd>
                </div>
                <p className="text-xs text-ink-subtle">
                  {quote.data.shippingExplanation} · {quote.data.shippingPolicy.document} v{quote.data.shippingPolicy.version}
                </p>
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd>{formatPrice(quote.data.total)}</dd>
                </div>
              </dl>
              <p className="flex gap-2 text-sm">
                <Truck className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                <span>
                  Arrives by <strong>{formatDay(quote.data.promisedDate)}</strong>
                  <span className="block text-xs text-ink-subtle">
                    Ships from {quote.data.warehouseCity}
                    {quote.data.crossRegion && ' (another region, +2 days)'}
                  </span>
                </span>
              </p>
            </>
          )}

          {place.isError && <p className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-stock-out">{place.error.message}</p>}
          <button form="checkout" type="submit" disabled={place.isPending || !quote.data} className={`${buttonStyles.primary} w-full`}>
            {place.isPending && <Spinner />} Place order
          </button>
          <Link to="/cart" className="block text-center text-xs text-ink-muted hover:text-ink">
            Back to cart
          </Link>
        </aside>
      </div>
    </div>
  )
}
