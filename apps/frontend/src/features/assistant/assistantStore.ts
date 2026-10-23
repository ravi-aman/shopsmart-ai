import { create } from 'zustand'
import type { RecommendResponse, Step } from '@/features/assistant/types'
import { ApiError } from '@/lib/api'
import { postSse } from '@/lib/sse'

export interface Turn {
  id: string
  query: string
  /** What was actually sent: a clarification answer is merged with the question it answers. */
  sentQuery: string
  steps: Step[]
  result: RecommendResponse | null
  error: string | null
  pending: boolean
}

interface AssistantState {
  open: boolean
  turns: Turn[]
  conversationId: string
  setOpen: (open: boolean) => void
  ask: (query: string) => Promise<void>
  reset: () => void
}

let controller: AbortController | null = null

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 36)

export const useAssistant = create<AssistantState>()((set, get) => ({
  open: false,
  turns: [],
  conversationId: newId(),
  setOpen: (open) => set({ open }),
  reset: () => {
    controller?.abort()
    set({ turns: [], conversationId: newId() })
  },
  ask: async (query) => {
    const text = query.trim()
    if (!text || get().turns.some((t) => t.pending)) return
    const last = get().turns.at(-1)
    // A reply to a clarifying question keeps the original request's context.
    const sentQuery = last?.result?.clarifyingQuestion ? `${last.sentQuery}. ${text}` : text
    const turn: Turn = { id: newId(), query: text, sentQuery, steps: [], result: null, error: null, pending: true }
    set((s) => ({ open: true, turns: [...s.turns, turn] }))

    const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      set((s) => ({
        turns: s.turns.map((t) => (t.id === turn.id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
      }))

    controller?.abort()
    controller = new AbortController()
    try {
      await postSse(
        '/api/ai/shopping/stream',
        { query: sentQuery.slice(0, 500), conversationId: get().conversationId },
        (event, data) => {
          if (event === 'step') {
            const step = data as Step
            update((t) => ({
              steps: t.steps.some((s) => s.id === step.id) ? t.steps.map((s) => (s.id === step.id ? step : s)) : [...t.steps, step],
            }))
          } else if (event === 'result') {
            update({ result: data as RecommendResponse, pending: false })
          } else if (event === 'error') {
            update({ error: (data as { message?: string }).message ?? 'Something went wrong', pending: false })
          }
        },
        controller.signal,
      )
      update((t) => (t.pending ? { pending: false, error: t.result ? null : 'The assistant stopped before answering.' } : {}))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      update({ pending: false, error: e instanceof ApiError ? e.message : 'Could not reach the assistant. Is the backend running?' })
    }
  },
}))
