import { create } from 'zustand'
import type { AgentName, AssistantResult, Step } from '@/features/assistant/types'
import { ApiError } from '@/lib/api'
import { postSse } from '@/lib/sse'

/** A product the shopper is asking about (set from the product page). */
export interface ProductContext {
  id: string
  name: string
}

export interface Turn {
  id: string
  query: string
  /** What was actually sent: a clarification answer is merged with the question it answers. */
  sentQuery: string
  product: ProductContext | null
  agent: AgentName | null
  steps: Step[]
  result: AssistantResult | null
  error: string | null
  pending: boolean
}

interface AssistantState {
  open: boolean
  turns: Turn[]
  conversationId: string
  product: ProductContext | null
  setOpen: (open: boolean) => void
  setProduct: (product: ProductContext | null) => void
  ask: (query: string, product?: ProductContext | null) => Promise<void>
  reset: () => void
}

let controller: AbortController | null = null

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 36)

export const useAssistant = create<AssistantState>()((set, get) => ({
  open: false,
  turns: [],
  conversationId: newId(),
  product: null,
  setOpen: (open) => set({ open }),
  setProduct: (product) => set({ product }),
  reset: () => {
    controller?.abort()
    set({ turns: [], conversationId: newId(), product: null })
  },
  ask: async (query, productArg) => {
    const text = query.trim()
    if (!text || get().turns.some((t) => t.pending)) return
    const product = productArg === undefined ? get().product : productArg
    const last = get().turns.at(-1)
    // A reply to a shopping clarifying question keeps the original request's context.
    const clarifying = last?.result?.agent === 'SHOPPING' && last.result.data.clarifyingQuestion
    const sentQuery = clarifying ? `${last.sentQuery}. ${text}` : text
    const turn: Turn = {
      id: newId(),
      query: text,
      sentQuery,
      product,
      agent: null,
      steps: [],
      result: null,
      error: null,
      pending: true,
    }
    set((s) => ({ open: true, product, turns: [...s.turns, turn] }))

    const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      set((s) => ({
        turns: s.turns.map((t) => (t.id === turn.id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
      }))

    controller?.abort()
    controller = new AbortController()
    try {
      await postSse(
        '/api/ai/assistant/stream',
        { message: sentQuery.slice(0, 600), productId: product?.id ?? null, conversationId: get().conversationId },
        (event, data) => {
          if (event === 'route') {
            update({ agent: (data as { agent: AgentName }).agent })
          } else if (event === 'step') {
            const step = data as Step
            update((t) => ({
              steps: t.steps.some((s) => s.id === step.id) ? t.steps.map((s) => (s.id === step.id ? step : s)) : [...t.steps, step],
            }))
          } else if (event === 'result') {
            update({ result: data as AssistantResult, pending: false })
          } else if (event === 'error') {
            update({ error: (data as { message?: string }).message ?? 'Something went wrong', pending: false })
          }
        },
        controller.signal,
      )
      update((t) => (t.pending ? { pending: false, error: t.result ? null : 'The assistant stopped before answering.' } : {}))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      update({ pending: false, error: e instanceof ApiError ? e.message : 'Could not reach the assistant. Is the API running?' })
    }
  },
}))
