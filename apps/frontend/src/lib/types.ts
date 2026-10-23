export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
export type MembershipTier = 'BASIC' | 'PRIME' | 'PREMIUM'
export type Role = 'CUSTOMER' | 'ADMIN' | 'OPS' | 'PARTNER'

export type SpecValue = string | number | boolean
export type Specs = Record<string, SpecValue>

export interface ProductSummary {
  id: string
  slug: string
  name: string
  brand: string
  categorySlug: string
  categoryName: string
  price: number
  mrp: number | null
  currency: string
  rating: number
  ratingCount: number
  image: string | null
  specs: Specs
  availability: Availability
  availableQuantity: number
}

export interface CategoryNode {
  id: number
  slug: string
  name: string
  path: string
  productCount: number
  children: CategoryNode[]
}

export interface FacetValue {
  value: string
  label: string
  count: number
}

export interface Facet {
  key: string
  label: string
  values: FacetValue[]
}

export interface SearchResponse {
  items: ProductSummary[]
  page: number
  size: number
  totalItems: number
  totalPages: number
  facets: { facets: Facet[]; price: { min: number | null; max: number | null } }
}

export interface ProductDetail {
  product: ProductSummary
  description: string
  images: string[]
  tags: string[]
  breadcrumbs: { slug: string; name: string }[]
  stockByWarehouse: { warehouseId: string; city: string; region: string; available: number }[]
  related: ProductSummary[]
  promotion: { code: string; description: string; percent: number; endsAt: string } | null
  sizeChart: Record<string, Record<string, [number, number]>> | null
}

export interface Suggestion {
  type: 'category' | 'product'
  label: string
  slug: string
}

export interface User {
  id: string
  name: string
  email: string
  role: Role
  membershipTier: MembershipTier
  region: string
  createdAt: string
}

export interface Preferences {
  preferredCategories: string[]
  preferredBrands: string[]
  useCases: string[]
  budgetMin: number | null
  budgetMax: number | null
}

export interface CartLine {
  productId: string
  quantity: number
  product: ProductSummary
  lineTotal: number
}

export interface CartView {
  items: CartLine[]
  itemCount: number
  subtotal: number
  savings: number
}
