import { describe, expect, it } from 'vitest'
import { route } from '../src/ai/assistant.js'
import { applicableTier } from '../src/expiry/job.js'
import { numbersGrounded } from '../src/knowledge/answer.js'
import { markdown } from '../src/knowledge/parser.js'
import { riskOf } from '../src/ops/service.js'
import { explicitOrderId, intentOf, looksLikeOrderQuestion } from '../src/orders/agent.js'
import { cancelPolicyFor, deliveryDays, returnWindow, shippingFee } from '../src/orders/rules.js'

describe('assistant routing', () => {
  it.each([
    ['Where is my order?', 'ORDER'],
    ['mera order kab aayega', 'ORDER'],
    ['Can I cancel ORD-100023?', 'ORDER'],
    ['Can I cancel my order after shipment?', 'KNOWLEDGE'],
    ['What is the refund timeline?', 'KNOWLEDGE'],
    ['Suggest a laptop under $1000 for coding', 'SHOPPING'],
    ['Mujhe ₹2,000 ke andar winter jacket chahiye', 'SHOPPING'],
  ])('%s → %s', (msg, agent) => expect(route(msg, false)).toBe(agent))

  it('keeps product questions with the knowledge agent', () => expect(route('Can I return this?', true)).toBe('KNOWLEDGE'))

  it('reads order intent and ids', () => {
    expect(intentOf('please cancel it')).toBe('CANCEL')
    expect(intentOf('I want a refund')).toBe('RETURN')
    expect(intentOf('where is it')).toBe('TRACK')
    expect(explicitOrderId('status of ord100045 please')).toBe('ORD-100045')
    expect(looksLikeOrderQuestion('what is the return policy in general')).toBe(false)
  })
})

describe('order rules', () => {
  it('charges Basic members under $35 only', () => {
    expect(shippingFee('BASIC', 20).amount).toBe(4.99)
    expect(shippingFee('BASIC', 35).amount).toBe(0)
    expect(shippingFee('PRIME', 5).amount).toBe(0)
  })

  it('adds two days cross-region', () => {
    expect(deliveryDays('IN-WEST', 'IN-WEST')).toBe(2)
    expect(deliveryDays('IN-EAST', 'IN-WEST')).toBe(5)
  })

  it('uses the laptop window and blocks grocery returns', () => {
    expect(returnWindow('electronics/laptops').source.document).toBe('Laptop Return Policy')
    expect(returnWindow('groceries/fresh-pantry').days).toBe(0)
    expect(returnWindow('fashion/footwear').days).toBe(30)
  })

  it('maps statuses to cancellation sections', () => {
    expect(cancelPolicyFor('PACKED').section).toBe('Before Shipment')
    expect(cancelPolicyFor('OUT_FOR_DELIVERY').section).toBe('Out for Delivery')
    expect(cancelPolicyFor('SHIPPED').section).toBe('After Shipment')
  })
})

describe('expiry tiers', () => {
  const tiers = [
    { daysLeft: 5, percent: 15 },
    { daysLeft: 3, percent: 30 },
    { daysLeft: 1, percent: 50 },
  ]
  it('picks the deepest tier reached', () => {
    expect(applicableTier(tiers, 6)).toBeUndefined()
    expect(applicableTier(tiers, 4.2)?.percent).toBe(15)
    expect(applicableTier(tiers, 2.5)?.percent).toBe(30)
    expect(applicableTier(tiers, 0.4)?.percent).toBe(50)
  })
})

describe('forecast risk', () => {
  it('classifies cover against the 7-day lead time', () => {
    expect(riskOf(0, 2, 0)).toBe('OUT_OF_STOCK')
    expect(riskOf(10, 2, 5)).toBe('CRITICAL')
    expect(riskOf(20, 2, 10)).toBe('LOW')
    expect(riskOf(40, 1, 40)).toBe('OK')
    expect(riskOf(100, 0, null)).toBe('OVERSTOCK')
  })
})

describe('knowledge helpers', () => {
  it('rejects answers with numbers not in the source', () => {
    expect(numbersGrounded('Returns are accepted within 7 days.', 'within 7 days of delivery')).toBe(true)
    expect(numbersGrounded('Returns are accepted within 30 days.', 'within 7 days of delivery')).toBe(false)
  })

  it('keeps markdown heading paths', () => {
    expect(markdown('# T\n\n## A\ntext a\n### B\ntext b\n').map((s) => s.title)).toEqual(['A', 'A › B'])
  })
})
