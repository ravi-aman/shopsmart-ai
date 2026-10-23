import { createJSONStorage } from 'zustand/middleware'

/** localStorage that silently degrades to memory when storage is blocked (private mode, previews). */
export const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__shopsmart_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    const memory = new Map<string, string>()
    return {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    }
  }
})
