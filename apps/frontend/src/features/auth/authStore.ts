import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { configureAuth } from '@/lib/api'
import { safeStorage } from '@/lib/storage'
import type { User } from '@/lib/types'

interface AuthState {
  token: string | null
  user: User | null
  signIn: (token: string, user: User) => void
  signOut: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      signIn: (token, user) => set({ token, user }),
      signOut: () => set({ token: null, user: null }),
    }),
    { name: 'shopsmart.auth', storage: safeStorage },
  ),
)

configureAuth(
  () => useAuth.getState().token,
  () => useAuth.getState().signOut(),
)
