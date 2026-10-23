import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAuth } from '@/features/auth/authStore'
import { api } from '@/lib/api'
import { safeStorage } from '@/lib/storage'
import type { CartView, ProductSummary } from '@/lib/types'

export const MAX_QUANTITY = 20

interface GuestCartState {
  items: { productId: string; quantity: number }[]
  set: (productId: string, quantity: number) => void
  clear: () => void
}

/** Cart for signed-out shoppers, merged into the account on sign-in. */
export const useGuestCart = create<GuestCartState>()(
  persist(
    (set) => ({
      items: [],
      set: (productId, quantity) =>
        set((s) => ({
          items:
            quantity <= 0
              ? s.items.filter((i) => i.productId !== productId)
              : s.items.some((i) => i.productId === productId)
                ? s.items.map((i) => (i.productId === productId ? { ...i, quantity } : i))
                : [...s.items, { productId, quantity }],
        })),
      clear: () => set({ items: [] }),
    }),
    { name: 'shopsmart.guest-cart', storage: safeStorage },
  ),
)

const EMPTY: CartView = { items: [], itemCount: 0, subtotal: 0, savings: 0 }

export function useCart() {
  const token = useAuth((s) => s.token)
  const guestItems = useGuestCart((s) => s.items)
  const setGuest = useGuestCart((s) => s.set)
  const qc = useQueryClient()

  const server = useQuery({
    queryKey: ['cart'],
    queryFn: () => api<CartView>('/api/cart'),
    enabled: !!token,
  })

  const guestIds = guestItems.map((i) => i.productId).sort().join(',')
  const guestProducts = useQuery({
    queryKey: ['products-batch', guestIds],
    queryFn: () => api<ProductSummary[]>(`/api/catalog/products/batch?ids=${encodeURIComponent(guestIds)}`),
    enabled: !token && guestIds.length > 0,
  })

  const mutation = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      api<CartView>(`/api/cart/items/${productId}`, { method: 'PUT', body: JSON.stringify({ quantity }) }),
    onSuccess: (cart) => qc.setQueryData(['cart'], cart),
  })

  let cart: CartView = EMPTY
  if (token) {
    cart = server.data ?? EMPTY
  } else if (guestProducts.data) {
    const items = guestItems.flatMap((i) => {
      const product = guestProducts.data.find((p) => p.id === i.productId)
      return product ? [{ productId: i.productId, quantity: i.quantity, product, lineTotal: product.price * i.quantity }] : []
    })
    cart = {
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      subtotal: items.reduce((n, i) => n + i.lineTotal, 0),
      savings: items.reduce((n, i) => n + (i.product.mrp ? (i.product.mrp - i.product.price) * i.quantity : 0), 0),
    }
  }

  const itemCount = token ? cart.itemCount : guestItems.reduce((n, i) => n + i.quantity, 0)

  async function setQuantity(productId: string, quantity: number) {
    if (token) return mutation.mutateAsync({ productId, quantity })
    setGuest(productId, Math.min(quantity, MAX_QUANTITY))
  }

  function quantityOf(productId: string) {
    if (token) return cart.items.find((i) => i.productId === productId)?.quantity ?? 0
    return guestItems.find((i) => i.productId === productId)?.quantity ?? 0
  }

  return {
    cart,
    itemCount,
    isLoading: token ? server.isPending : guestIds.length > 0 && guestProducts.isPending,
    isUpdating: mutation.isPending,
    error: mutation.error,
    setQuantity,
    quantityOf,
  }
}

/** After sign-in: push the guest cart to the server, then forget it locally. */
export async function mergeGuestCart() {
  const { items, clear } = useGuestCart.getState()
  if (items.length === 0) return
  await api<CartView>('/api/cart/merge', { method: 'POST', body: JSON.stringify({ items }) })
  clear()
}
