import type { ProductSummary } from '../modules/catalog/repository.js'
import { has, type ShoppingIntent } from './intent.js'

export interface Criterion {
  name: string
  points: number
  max: number
  detail: string
}

export interface Scored {
  product: ProductSummary
  score: number
  breakdown: Criterion[]
  reasonParts: string[]
  matchedRequirements: string[]
  tradeoffs: string[]
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => (v == null ? '' : String(v))
const round1 = (v: number) => Math.round(v * 10) / 10
const plain = (n: number) => String(Number(n.toFixed(2)))

export function cpuTier(cpu: string) {
  const x = cpu.toLowerCase()
  if (/(i7|i9|ryzen [79]|ultra [79]|apple m[1-4] (pro|max)|apple m3|apple m4|snapdragon x elite)/.test(x)) return 3
  if (/(i5|ryzen 5|ultra 5|core 5|core 7|apple m[12]|snapdragon x plus)/.test(x)) return 2
  return 1
}

/** "Intel Core i7-1355U (10 cores)" → "Intel i7 processor"; "Apple M3 (8-core CPU)" → "Apple M3 chip". */
export function cpuShort(cpu: string) {
  const base = cpu.replace(/\s*\(.*\)/, '').trim()
  let m = base.match(/Intel Core (i\d)/)
  if (m) return `Intel ${m[1]} processor`
  m = base.match(/Intel Core (Ultra \d)/)
  if (m) return `Intel Core ${m[1]} processor`
  m = base.match(/AMD (Ryzen \d)/)
  if (m) return `AMD ${m[1]} processor`
  if (base.startsWith('Apple')) return `${base} chip`
  return `${base} processor`
}

/**
 * Deterministic, explainable scoring: every point is tied to a named criterion and a spec value, so
 * "why this?" can be answered exactly — the language model never decides the ranking.
 */
export function score(p: ProductSummary, intent: ShoppingIntent, preferredBrands: string[]): Scored {
  const s = p.specs as Record<string, unknown>
  const c: Criterion[] = []
  const reason: string[] = []
  const matched: string[] = []
  const tradeoffs: string[] = []

  if (intent.budgetMax != null) matched.push(`Within your $${plain(intent.budgetMax)} budget at $${plain(p.price)}`)
  if (s.type === 'Laptop') laptop(s, intent, c, reason, matched, tradeoffs)
  else if (s.type === 'Smartphone') phone(s, c, reason)
  else if (s.type === 'Audio') audio(s, c, reason)
  else if (s.type === 'Book') {
    if (s.author) reason.push(`By ${s.author}`)
  } else generic(s, reason)

  const rating = p.rating ?? 0
  c.push({ name: 'Customer rating', points: round1(rating * 2), max: 10, detail: `${rating}/5 from ${p.ratingCount} ratings` })
  if (reason.length < 2 && rating >= 4) reason.push(`rated ${rating}/5 by ${p.ratingCount} buyers`)
  if (p.mrp != null && p.mrp > p.price) {
    const off = Math.round(((p.mrp - p.price) * 100) / p.mrp)
    c.push({ name: 'Deal', points: Math.min(5, off / 4), max: 5, detail: `${off}% below list price` })
  } else c.push({ name: 'Deal', points: 0, max: 5, detail: 'No current discount' })

  const wanted = intent.brands.length ? intent.brands : preferredBrands
  if (wanted.length) {
    const hit = wanted.some((b) => b.toLowerCase() === p.brand.toLowerCase())
    c.push({ name: 'Brand preference', points: hit ? 5 : 0, max: 5, detail: hit ? `${p.brand} is a brand you prefer` : 'Not one of your preferred brands' })
    if (hit) matched.push(`From ${p.brand}, a brand you prefer`)
  }
  matched.push(p.availability === 'LOW_STOCK' ? 'In stock (only a few left)' : 'In stock')

  const got = c.reduce((n, x) => n + x.points, 0)
  const max = c.reduce((n, x) => n + x.max, 0)
  return { product: p, score: Math.round(max === 0 ? 0 : (got / max) * 100), breakdown: c, reasonParts: reason.slice(0, 4), matchedRequirements: matched, tradeoffs }
}

function laptop(s: Record<string, unknown>, intent: ShoppingIntent, c: Criterion[], reason: string[], matched: string[], tradeoffs: string[]) {
  const ai = has(intent, 'ai-ml')
  const dev = has(intent, 'software-development')
  const gpuWork = ai || has(intent, 'gaming') || has(intent, 'content-creation') || intent.needsDedicatedGpu === true
  const mobile = has(intent, 'travel') || has(intent, 'student')

  const ram = num(s.ramGb)
  c.push({ name: 'Memory', points: ram >= 32 ? 25 : ram >= 16 ? (ai ? 19 : 21) : ram >= 12 ? 14 : ram >= 8 ? (ai || dev ? 5 : 9) : 2, max: 25, detail: `${ram} GB RAM` })
  if (ram > 0) reason.push(`${ram}GB RAM`)
  if (ram >= 16 && (ai || dev)) matched.push(`${ram}GB RAM handles IDEs, builds and AI tooling`)
  if (ram > 0 && ram < 16 && (ai || dev)) tradeoffs.push(`${ram}GB RAM is tight for large IDE projects and AI libraries`)

  const cpu = str(s.cpu)
  const tier = cpuTier(cpu)
  c.push({ name: 'Processor', points: tier === 3 ? 20 : tier === 2 ? 13 : 6, max: 20, detail: cpu })
  if (cpu) reason.push(cpuShort(cpu))
  if (tier === 3 && dev) matched.push('High-performance CPU for fast compiles')

  const storage = num(s.storageGb)
  const type = str(s.storageType)
  const ssd = type.toUpperCase() === 'SSD'
  c.push({ name: 'Storage', points: !ssd ? 2 : storage >= 1024 ? 15 : storage >= 512 ? 12 : storage >= 256 ? 7 : 4, max: 15, detail: `${storage >= 1024 ? `${storage / 1024} TB` : `${storage} GB`} ${type}` })
  if (ssd) reason.push('SSD storage')
  else tradeoffs.push(`${type} storage is much slower than an SSD`)

  const gpu = str(s.gpu)
  const m = gpu.match(/(rtx|gtx)\s*(\d{4})/i)
  const model = m ? Number(m[2]) : 0
  const discrete = model > 0 || gpu.toLowerCase().includes('radeon rx')
  if (gpuWork) {
    c.push({ name: 'Graphics', points: model >= 4070 ? 20 : model >= 4060 ? 17 : model >= 4050 ? 15 : model > 0 ? 9 : gpu.startsWith('Apple') ? 8 : 3, max: 20, detail: gpu })
    if (discrete) {
      reason.push(`${gpu.replace('NVIDIA GeForce ', 'NVIDIA ')} GPU`)
      if (ai) matched.push('Dedicated NVIDIA GPU with CUDA for ML experiments')
    } else if (ai) tradeoffs.push('Integrated graphics — fine for learning and cloud notebooks, not for local GPU training')
  }

  const os = str(s.os)
  if (dev || ai) {
    c.push({ name: 'Developer platform', points: os.includes('ChromeOS') ? 0 : os.includes('Arm') ? 5 : os.startsWith('macOS') && ai ? 7 : 10, max: 10, detail: os })
    if (os.includes('ChromeOS')) tradeoffs.push('ChromeOS cannot run full desktop IDEs like IntelliJ')
    if (os.includes('Arm')) tradeoffs.push('Windows on Arm runs some x86 developer tools under emulation')
  }

  const weight = num(s.weightKg)
  const battery = num(s.batteryHours)
  if (mobile) {
    c.push({ name: 'Portability', points: weight <= 1.3 ? 10 : weight <= 1.6 ? 7 : weight <= 2.0 ? 4 : 1, max: 10, detail: `${weight} kg` })
    if (weight > 2.0) tradeoffs.push(`Heavy to carry daily (${weight} kg)`)
  }
  c.push({ name: 'Battery', points: battery >= 15 ? 5 : battery >= 10 ? 4 : battery >= 8 ? 3 : 1, max: 5, detail: `Up to ${battery} h` })
}

function phone(s: Record<string, unknown>, c: Criterion[], reason: string[]) {
  const ram = num(s.ramGb)
  const storage = num(s.storageGb)
  const cam = num(s.mainCameraMp)
  const battery = num(s.batteryMah)
  c.push({ name: 'Memory', points: ram >= 12 ? 10 : ram >= 8 ? 7 : 3, max: 10, detail: `${ram} GB RAM` })
  c.push({ name: 'Storage', points: storage >= 256 ? 10 : storage >= 128 ? 7 : 3, max: 10, detail: `${storage} GB` })
  c.push({ name: 'Battery', points: battery >= 5000 ? 10 : battery >= 4000 ? 7 : 4, max: 10, detail: `${battery} mAh` })
  c.push({ name: 'Camera', points: cam >= 50 ? 10 : cam >= 48 ? 8 : 5, max: 10, detail: `${cam} MP main camera` })
  if (ram > 0) reason.push(`${ram}GB RAM`)
  if (storage > 0) reason.push(`${storage}GB storage`)
  if (battery > 0) reason.push(`${battery}mAh battery`)
  if (cam > 0) reason.push(`${cam}MP camera`)
}

function audio(s: Record<string, unknown>, c: Criterion[], reason: string[]) {
  const anc = s.noiseCancelling === true
  const battery = num(s.batteryHours)
  c.push({ name: 'Noise cancelling', points: anc ? 10 : 2, max: 10, detail: anc ? 'Active noise cancelling' : 'No ANC' })
  c.push({ name: 'Battery', points: battery >= 24 ? 10 : battery >= 10 ? 7 : 4, max: 10, detail: `Up to ${battery} h` })
  if (anc) reason.push('active noise cancelling')
  if (battery > 0) reason.push(`${battery}-hour battery`)
  if (s.formFactor != null) reason.push(`${String(s.formFactor).toLowerCase()} design`)
}

function generic(s: Record<string, unknown>, reason: string[]) {
  const labels: Record<string, (v: unknown) => string> = {
    capacityKg: (v) => `${v} kg capacity`,
    capacityLitres: (v) => `${v} L capacity`,
    capacityTon: (v) => `${v} ton capacity`,
    energyRating: (v) => `${v} energy rating`,
    technology: String,
    measurement: String,
    formFactor: String,
  }
  for (const [k, fmt] of Object.entries(labels)) if (s[k] != null) reason.push(fmt(s[k]))
}
