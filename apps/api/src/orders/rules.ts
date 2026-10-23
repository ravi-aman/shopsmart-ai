/**
 * Business rules mirroring the approved policy documents (Shipping Policy, Delivery SLA, Return
 * Policy, Cancellation Policy). Each rule names the document and section it comes from, so the
 * order agent and UI can cite it.
 */
export interface PolicyRef {
  document: string
  section: string
}

export const SHIPPING_BASIC = { document: 'Shipping Policy', section: 'Shipping Fees for Basic Members' }
export const SHIPPING_PRIME = { document: 'Shipping Policy', section: 'Shipping Fees for Prime Members' }
export const SHIPPING_PREMIUM = { document: 'Shipping Policy', section: 'Shipping Fees for Premium Members' }
export const CANCEL_BEFORE = { document: 'Order Cancellation Policy', section: 'Before Shipment' }
export const CANCEL_AFTER = { document: 'Order Cancellation Policy', section: 'After Shipment' }
export const CANCEL_OFD = { document: 'Order Cancellation Policy', section: 'Out for Delivery' }
export const RETURN_WINDOWS = { document: 'ShopSmart Return Policy', section: 'Return Windows by Category' }
export const RETURN_LAPTOP = { document: 'Laptop Return Policy', section: 'Opened Products' }

const FREE_SHIPPING_THRESHOLD = 35
const BASIC_SHIPPING_FEE = 4.99

export function shippingFee(tier: string, subtotal: number) {
  if (tier === 'PREMIUM') return { amount: 0, explanation: 'Free delivery for Premium members', source: SHIPPING_PREMIUM }
  if (tier === 'PRIME') return { amount: 0, explanation: 'Free Standard delivery for Prime members, no minimum', source: SHIPPING_PRIME }
  return subtotal >= FREE_SHIPPING_THRESHOLD
    ? { amount: 0, explanation: 'Free Standard delivery on orders of $35 or more', source: SHIPPING_BASIC }
    : { amount: BASIC_SHIPPING_FEE, explanation: '$4.99 delivery on orders under $35 (Basic)', source: SHIPPING_BASIC }
}

/** Standard delivery days from the Delivery SLA (metro estimate) plus 2 days when shipping cross-region. */
export function deliveryDays(customerRegion: string, warehouseRegion: string) {
  const base = customerRegion === 'IN-EAST' ? 3 : 2
  return customerRegion === warehouseRegion ? base : base + 2
}

export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const today = () => new Date().toISOString().slice(0, 10)

export const CANCELLABLE = new Set(['PLACED', 'PACKED'])

export const cancelPolicyFor = (status: string) => (CANCELLABLE.has(status) ? CANCEL_BEFORE : status === 'OUT_FOR_DELIVERY' ? CANCEL_OFD : CANCEL_AFTER)

const RETURN_DAYS: Record<string, number> = { electronics: 7, fashion: 30, 'home-appliances': 10, books: 10, healthcare: 7, groceries: 0 }

export function returnWindow(categoryPath: string) {
  if (categoryPath.endsWith('/laptops')) return { days: 7, source: RETURN_LAPTOP }
  const top = categoryPath.split('/')[0]
  return { days: RETURN_DAYS[top] ?? 7, source: RETURN_WINDOWS }
}

export const round2 = (n: number) => Math.round(n * 100) / 100
