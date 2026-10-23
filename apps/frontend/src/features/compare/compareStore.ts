import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/lib/storage'

export const MAX_COMPARE = 4

export interface CompareItem {
  id: string
  name: string
  image: string | null
  categorySlug: string
}

interface CompareState {
  items: CompareItem[]
  toggle: (item: CompareItem) => 'added' | 'removed' | 'full'
  remove: (id: string) => void
  clear: () => void
}

export const useCompare = create<CompareState>()(
  persist(
    (set, get) => ({
      items: [],
      toggle: (item) => {
        const items = get().items
        if (items.some((i) => i.id === item.id)) {
          set({ items: items.filter((i) => i.id !== item.id) })
          return 'removed'
        }
        if (items.length >= MAX_COMPARE) return 'full'
        set({ items: [...items, item] })
        return 'added'
      },
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'shopsmart.compare', storage: safeStorage },
  ),
)
