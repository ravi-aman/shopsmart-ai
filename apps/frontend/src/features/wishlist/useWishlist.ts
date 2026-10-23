import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/features/auth/authStore'
import { api } from '@/lib/api'

export function useWishlist() {
  const token = useAuth((s) => s.token)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const ids = useQuery({
    queryKey: ['wishlist-ids'],
    queryFn: () => api<string[]>('/api/wishlist/ids'),
    enabled: !!token,
  })

  const toggle = useMutation({
    mutationFn: ({ productId, saved }: { productId: string; saved: boolean }) =>
      api<void>(`/api/wishlist/${productId}`, { method: saved ? 'DELETE' : 'PUT' }),
    onMutate: ({ productId, saved }) => {
      qc.setQueryData<string[]>(['wishlist-ids'], (old = []) =>
        saved ? old.filter((id) => id !== productId) : [productId, ...old],
      )
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['wishlist-ids'] })
      qc.invalidateQueries({ queryKey: ['wishlist'] })
    },
  })

  const saved = new Set(ids.data ?? [])

  return {
    has: (productId: string) => saved.has(productId),
    count: saved.size,
    toggle: (productId: string) => {
      if (!token) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
        return
      }
      toggle.mutate({ productId, saved: saved.has(productId) })
    },
  }
}
