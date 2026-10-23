export type OrderStatus =
  | 'PLACED'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED'
  | 'REFUNDED'

export interface Policy {
  document: string
  section: string
  version: string | null
}

export interface Address {
  name: string
  line1: string
  city: string
  pincode: string
  region: string
  phone: string
}

export interface Quote {
  subtotal: number
  discount: number
  promotionCodes: string[]
  shippingFee: number
  total: number
  shippingExplanation: string
  shippingPolicy: Policy
  warehouseId: string
  warehouseCity: string
  promisedDate: string
  crossRegion: boolean
  itemCount: number
}

export interface ReturnInfo {
  eligible: boolean
  deadline: string | null
  reason: string
  policy: Policy
  requestStatus: string | null
}

export interface OrderItem {
  productId: string
  name: string
  slug: string
  image: string | null
  brand: string
  category: string
  quantity: number
  unitPrice: number
  returnInfo: ReturnInfo
}

export interface TrackingEvent {
  status: string
  location: string | null
  note: string | null
  at: string
}

export interface OrderDetail {
  id: string
  status: OrderStatus
  subtotal: number
  discount: number
  shippingFee: number
  total: number
  currency: string
  address: Address
  warehouseId: string
  warehouseCity: string
  promisedDate: string
  createdAt: string
  deliveredAt: string | null
  items: OrderItem[]
  shipment: { id: string; carrier: string; trackingNo: string; eta: string; delayed: boolean; events: TrackingEvent[] } | null
  cancel: { allowed: boolean; reason: string; policy: Policy }
}

export interface OrderSummary {
  id: string
  status: OrderStatus
  total: number
  currency: string
  itemCount: number
  firstItemName: string
  firstItemImage: string | null
  promisedDate: string
  createdAt: string
}

export const statusLabel: Record<OrderStatus, string> = {
  PLACED: 'Order placed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURN_REQUESTED: 'Return requested',
  RETURNED: 'Returned',
  REFUNDED: 'Refunded',
}

export const statusTone: Record<OrderStatus, string> = {
  PLACED: 'bg-canvas text-ink',
  PACKED: 'bg-canvas text-ink',
  SHIPPED: 'bg-ai-soft text-ai',
  OUT_FOR_DELIVERY: 'bg-ai-soft text-ai',
  DELIVERED: 'bg-[#e6f4ea] text-stock-in',
  CANCELLED: 'bg-[#fdecec] text-stock-out',
  RETURN_REQUESTED: 'bg-[#fdf3e2] text-stock-low',
  RETURNED: 'bg-canvas text-ink-muted',
  REFUNDED: 'bg-canvas text-ink-muted',
}

export const flow: OrderStatus[] = ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']

export function formatDay(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
