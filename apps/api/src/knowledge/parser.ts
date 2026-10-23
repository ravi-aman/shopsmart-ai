import { extractText, getDocumentProxy } from 'unpdf'

export type SourceType = 'PDF' | 'MARKDOWN' | 'JSON'

export interface Section {
  title: string
  text: string
}

export function detectType(fileName: string): SourceType {
  const f = fileName.toLowerCase()
  if (f.endsWith('.pdf')) return 'PDF'
  if (f.endsWith('.md') || f.endsWith('.markdown')) return 'MARKDOWN'
  if (f.endsWith('.json')) return 'JSON'
  throw new Error('Unsupported file type — upload PDF, Markdown (.md) or JSON')
}

export function normalize(text: string) {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Turns an uploaded file into titled sections. Sections are the unit of citation
 * ("Laptop Return Policy › Opened Products"), so every parser keeps heading structure.
 */
export async function parseDocument(content: Buffer, type: SourceType, documentTitle: string): Promise<Section[]> {
  const sections = type === 'PDF' ? await pdf(content, documentTitle) : type === 'MARKDOWN' ? markdown(content.toString('utf8')) : json(content, documentTitle)
  const cleaned = sections.map((s) => ({ title: s.title.trim(), text: normalize(s.text) })).filter((s) => s.text.length > 0)
  if (cleaned.length === 0) throw new Error('No readable text found in the document')
  return cleaned
}

async function pdf(content: Buffer, documentTitle: string) {
  const doc = await getDocumentProxy(new Uint8Array(content))
  const { text } = await extractText(doc, { mergePages: true })
  return headingSections(text, documentTitle)
}

/** Splits PDF text on heading-like lines and re-joins lines the PDF wrapped mid-sentence. */
export function headingSections(text: string, documentTitle: string): Section[] {
  const out: Section[] = []
  let current = 'Overview'
  let para = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (line.toLowerCase() === documentTitle.toLowerCase() || /^version\s+\S+.*effective/i.test(line)) continue
    if (isHeading(line)) {
      if (para.trim()) out.push({ title: current, text: para })
      para = ''
      current = line
      continue
    }
    if (para) para += '.!?:'.includes(para.at(-1)!) ? '\n' : ' '
    para += line
  }
  if (para.trim()) out.push({ title: current, text: para })
  return out
}

export function isHeading(line: string) {
  if (line.length < 3 || line.length > 70) return false
  if ('.:;,'.includes(line.at(-1)!)) return false
  if (line[0] !== line[0].toUpperCase() || !/[A-Z]/.test(line[0])) return false
  const words = line.split(/\s+/)
  if (words.length > 8) return false
  const counted = words.filter((w) => !(w.length <= 3 && w === w.toLowerCase()))
  return counted.length > 0 && counted.every((w) => /^[A-Z0-9]/.test(w))
}

/** "## Opened Products" starts a section; "###" nests as "Parent › Child"; "# Title" is the document title. */
export function markdown(md: string): Section[] {
  const out: Section[] = []
  let h2: string | null = null
  let h3: string | null = null
  let buf = ''
  let inCode = false
  const flush = () => {
    if (buf.trim()) out.push({ title: h2 == null ? 'Overview' : h3 == null ? h2 : `${h2} › ${h3}`, text: buf })
    buf = ''
  }
  for (const line of md.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (!inCode && line.startsWith('### ')) {
      flush()
      h3 = line.slice(4).trim()
    } else if (!inCode && line.startsWith('## ')) {
      flush()
      h2 = line.slice(3).trim()
      h3 = null
    } else if (!inCode && line.startsWith('# ')) {
      flush()
    } else {
      buf += `${line.replace(/^\s*[-*+]\s+/, '• ')}\n`
    }
  }
  flush()
  return out
}

const humanize = (key: string) => {
  const s = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Supports {"sections":[{"title","content"}]}; anything else is flattened to "path: value" lines per top-level key. */
function json(content: Buffer, documentTitle: string): Section[] {
  let root: unknown
  try {
    root = JSON.parse(content.toString('utf8'))
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
  const r = root as Record<string, unknown>
  if (Array.isArray(r?.sections)) {
    return (r.sections as Record<string, unknown>[]).map((s) => ({ title: String(s.title ?? 'Section'), text: String(s.content ?? '') }))
  }
  const flatten = (node: unknown, path: string, lines: string[]) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) flatten(v, path ? `${path} › ${humanize(k)}` : humanize(k), lines)
    } else if (Array.isArray(node)) node.forEach((v) => flatten(v, path, lines))
    else lines.push(path ? `${path}: ${node}` : String(node))
  }
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    return Object.entries(r).map(([k, v]) => {
      const lines: string[] = []
      flatten(v, '', lines)
      return { title: humanize(k), text: lines.join('\n') }
    })
  }
  const lines: string[] = []
  flatten(root, '', lines)
  return [{ title: documentTitle, text: lines.join('\n') }]
}

// ------------------------------------------------------------------ chunking

/** ~350 tokens ≈ 1,400 characters; short sections stay whole, long ones split on paragraph/sentence boundaries. */
const SPLIT_ABOVE_CHARS = 1600
const TARGET_CHARS = 1400

export interface Chunk {
  index: number
  section: string
  body: string
  content: string
}

/**
 * Section-aware chunking: a chunk never crosses a section boundary and every chunk carries a
 * context header ("Laptop Return Policy v2026.1 › Opened Products") so it is retrievable on its own.
 */
export function chunk(documentTitle: string, version: string, sections: Section[]): Chunk[] {
  const out: Chunk[] = []
  for (const s of sections) {
    const bodies = s.text.length <= SPLIT_ABOVE_CHARS ? [s.text] : splitText(s.text)
    for (const body of bodies) {
      const b = body.trim()
      out.push({ index: out.length, section: s.title, body: b, content: `${documentTitle} v${version} › ${s.title}\n${b}` })
    }
  }
  return out
}

function splitText(text: string): string[] {
  const units = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const u of units) {
    if (cur && cur.length + u.length + 1 > TARGET_CHARS) {
      out.push(cur)
      cur = ''
    }
    cur += (cur ? ' ' : '') + u
  }
  if (cur) out.push(cur)
  return out
}
