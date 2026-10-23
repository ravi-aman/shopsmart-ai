import type { Availability } from '@/lib/types'

export interface Criterion {
  name: string
  points: number
  max: number
  detail: string
}

export interface Recommendation {
  productId: string
  productName: string
  reason: string
  availability: Availability
  explanation: string | null
  slug: string
  brand: string
  price: number
  mrp: number | null
  currency: string
  image: string | null
  rating: number
  score: number
  matchedRequirements: string[]
  tradeoffs: string[]
  scoreBreakdown: Criterion[]
}

export interface Interpretation {
  category: string | null
  budgetMin: number | null
  budgetMax: number | null
  useCases: string[]
  minRamGb: number | null
  minStorageGb: number | null
  needsDedicatedGpu: boolean | null
  preferredOs: string | null
  brands: string[]
  source: 'LLM' | 'RULES'
}

export interface RecommendResponse {
  interpretedRequirement: string
  budget: number | null
  recommendations: Recommendation[]
  clarifyingQuestion: string | null
  summary: string | null
  interpretation: Interpretation
  notices: string[]
  auditId: string | null
  aiAssisted: boolean
}

export interface Step {
  id: string
  label: string
  status: 'running' | 'done'
  durationMs: number | null
}

export interface Decision {
  id: string
  agent: string
  intent: string
  input: string
  extractedParams: Record<string, unknown>
  toolCalls: Record<string, unknown>[]
  retrievedIds: string[]
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
  error: string | null
  createdAt: string
}
