import { describe, expect, it } from 'vitest'
import type { ProductSummary } from '../src/modules/catalog/repository.js'
import { keywords } from '../src/shopping/candidates.js'
import { parseRules } from '../src/shopping/intent.js'
import { factNumbers, grounded } from '../src/shopping/reasons.js'
import { cpuShort, score } from '../src/shopping/scorer.js'

const lap101: ProductSummary = {
  id: 'LAP101',
  slug: 'dell-inspiron-15-lap101',
  name: 'Dell Inspiron 15',
  brand: 'Dell',
  categorySlug: 'laptops',
  categoryName: 'Laptops',
  price: 899,
  mrp: 1049,
  currency: 'USD',
  rating: 4.3,
  ratingCount: 1549,
  image: null,
  availability: 'IN_STOCK',
  availableQuantity: 125,
  specs: { type: 'Laptop', cpu: 'Intel Core i7-1355U (10 cores)', ramGb: 16, storageGb: 512, storageType: 'SSD', gpu: 'Intel Iris Xe', displayInches: 15.6, weightKg: 1.65, batteryHours: 8, os: 'Windows 11 Home' },
}

describe('intent parsing', () => {
  it('parses the brief example', () => {
    const i = parseRules('Suggest a laptop under $1000 for Java development and AI projects.', ['Dell'])
    expect(i.category).toBe('laptops')
    expect(i.budgetMax).toBe(1000)
    expect(i.useCases).toEqual(['software-development', 'ai-ml'])
    expect(i.clarifyingQuestion).toBeNull()
  })

  it('asks when the product type is unknown', () => {
    const i = parseRules('something nice for my mom', [])
    expect(i.category).toBeNull()
    expect(i.clarifyingQuestion).toBeTruthy()
  })

  it('treats headphones as audio and lets the later budget win', () => {
    expect(parseRules('noise cancelling headphones', []).category).toBe('audio')
    expect(parseRules('cheap laptop under $300. Show options up to $500', []).budgetMax).toBe(500)
  })

  it('parses RAM, GPU and "k" budgets', () => {
    const i = parseRules('gaming laptop with 32GB RAM and RTX under 1.2k', [])
    expect(i.minRamGb).toBe(32)
    expect(i.needsDedicatedGpu).toBe(true)
    expect(i.budgetMax).toBe(1200)
  })

  it('converts Hinglish rupee budgets to dollars', () => {
    const i = parseRules('Mujhe ₹2,000 ke andar winter jacket chahiye', [])
    expect(i.category).toBe('fashion')
    expect(i.budgetMax).toBeCloseTo(2000 / 83, 0)
    expect(i.interpretedRequirement).toContain('₹2,000')
  })
})

describe('scoring and grounding', () => {
  it('scores LAP101 with the brief reason', () => {
    const intent = parseRules('laptop under $1000 for Java development and AI projects', [])
    const s = score(lap101, intent, [])
    expect(s.reasonParts.join(', ')).toBe('16GB RAM, Intel i7 processor, SSD storage')
    expect(s.tradeoffs.some((t) => t.includes('Integrated graphics'))).toBe(true)
    const sum = s.breakdown.reduce((n, c) => n + c.points, 0)
    const max = s.breakdown.reduce((n, c) => n + c.max, 0)
    expect(s.score).toBe(Math.round((sum / max) * 100))
  })

  it('rejects explanations with invented numbers', () => {
    const q = 'laptop under $1000 for Java'
    const intent = parseRules(q, [])
    const facts = factNumbers(score(lap101, intent, []), intent, q)
    expect(grounded('16GB RAM and an i7 keep builds fast, at $899 within your $1,000 budget.', facts)).toBe(true)
    expect(grounded('Benchmarks show 35% faster builds with 12 hours of battery.', facts)).toBe(false)
  })

  it('shortens CPU names', () => {
    expect(cpuShort('Intel Core i7-1355U (10 cores)')).toBe('Intel i7 processor')
    expect(cpuShort('AMD Ryzen 7 7730U (8 cores)')).toBe('AMD Ryzen 7 processor')
    expect(cpuShort('Apple M3 (8-core CPU)')).toBe('Apple M3 chip')
    expect(cpuShort('Intel Core Ultra 7 155H (16 cores)')).toBe('Intel Core Ultra 7 processor')
  })

  it('drops filler words from keyword queries', () => {
    const k = keywords('Suggest a laptop under $1000 for Java development and AI projects')
    expect(k).toEqual(expect.arrayContaining(['laptop', 'java', 'development', 'ai']))
    expect(k).not.toContain('suggest')
  })
})
