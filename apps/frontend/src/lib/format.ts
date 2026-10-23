import type { SpecValue, Specs } from '@/lib/types'

const money = new Map<string, Intl.NumberFormat>()

/** Whole amounts print without cents ($899); others always show two decimals ($1,544.90). */
export function formatPrice(value: number, currency = 'USD') {
  const digits = Number.isInteger(value) ? 0 : 2
  const cacheKey = `${currency}:${digits}`
  let f = money.get(cacheKey)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
    money.set(cacheKey, f)
  }
  return f.format(value)
}

export function discountPercent(price: number, mrp: number | null) {
  if (!mrp || mrp <= price) return 0
  return Math.round(((mrp - price) / mrp) * 100)
}

export const specLabels: Record<string, string> = {
  type: 'Type',
  cpu: 'Processor',
  ramGb: 'RAM',
  storageGb: 'Storage',
  storageType: 'Storage type',
  gpu: 'Graphics',
  displayInches: 'Display',
  refreshHz: 'Refresh rate',
  weightKg: 'Weight',
  batteryHours: 'Battery life',
  os: 'Operating system',
  npu: 'AI accelerator (NPU)',
  convertible: '2-in-1 convertible',
  chipset: 'Chipset',
  batteryMah: 'Battery',
  mainCameraMp: 'Main camera',
  formFactor: 'Form factor',
  noiseCancelling: 'Noise cancelling',
  connectivity: 'Connectivity',
  waterproof: 'Water resistance',
  capacityKg: 'Capacity',
  capacityLitres: 'Capacity',
  capacityTon: 'Capacity',
  energyRating: 'Energy rating',
  author: 'Author',
  pages: 'Pages',
  format: 'Format',
  dimensionsCm: 'Dimensions (cm)',
}

const units: Record<string, (v: SpecValue) => string> = {
  ramGb: (v) => `${v} GB`,
  storageGb: (v) => (Number(v) >= 1024 ? `${Number(v) / 1024} TB` : `${v} GB`),
  displayInches: (v) => `${v}″`,
  refreshHz: (v) => `${v} Hz`,
  weightKg: (v) => `${v} kg`,
  batteryHours: (v) => `Up to ${v} h`,
  batteryMah: (v) => `${v} mAh`,
  mainCameraMp: (v) => `${v} MP`,
  capacityKg: (v) => `${v} kg`,
  capacityLitres: (v) => `${v} L`,
  capacityTon: (v) => `${v} ton`,
}

const specOrder = Object.keys(specLabels)

/** Postgres jsonb reorders keys; sort spec keys into the display order of specLabels. */
export function sortSpecKeys(keys: string[]) {
  const rank = (k: string) => (specOrder.includes(k) ? specOrder.indexOf(k) : specOrder.length)
  return [...keys].sort((a, b) => rank(a) - rank(b))
}

export function specLabel(key: string) {
  return specLabels[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

export function formatSpec(key: string, value: SpecValue | undefined) {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return units[key]?.(value) ?? String(value)
}

/** Facet values for spec filters, e.g. "1024" storage → "1 TB". */
export function formatFacetValue(facetKey: string, value: string) {
  return facetKey.startsWith('spec.') ? formatSpec(facetKey.slice(5), value) : value
}

/** Short spec line for product cards: "16 GB · 512 GB · Intel Core i7". */
export function keySpecs(specs: Specs): string[] {
  const out: string[] = []
  const pick = (k: string) => specs[k] !== undefined && out.push(formatSpec(k, specs[k]))
  if (specs.type === 'Laptop') {
    if (specs.cpu) out.push(String(specs.cpu).replace(/\s*\(.*\)/, ''))
    pick('ramGb')
    pick('storageGb')
    if (specs.gpu && /RTX|GTX|Radeon RX/.test(String(specs.gpu))) out.push(String(specs.gpu).replace('NVIDIA GeForce ', ''))
  } else if (specs.type === 'Smartphone') {
    pick('ramGb')
    pick('storageGb')
    pick('mainCameraMp')
  } else if (specs.type === 'Book') {
    if (specs.author) out.push(String(specs.author))
    if (specs.format) out.push(String(specs.format))
  } else {
    for (const k of ['formFactor', 'capacityKg', 'capacityLitres', 'capacityTon', 'energyRating', 'batteryHours']) pick(k)
  }
  return out.slice(0, 4)
}

export const availabilityLabel = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Only a few left',
  OUT_OF_STOCK: 'Out of stock',
} as const

export const regionLabel: Record<string, string> = {
  'IN-WEST': 'West India',
  'IN-NORTH': 'North India',
  'IN-SOUTH': 'South India',
  'IN-EAST': 'East India',
}
