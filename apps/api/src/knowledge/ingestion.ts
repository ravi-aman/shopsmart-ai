import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config, nvidiaConfigured } from '../config.js'
import { ApiError, badRequest, notFound } from '../http/errors.js'
import { logger } from '../logger.js'
import { PolicyChunk, PolicyDocument } from '../models/index.js'
import { embedMany } from '../ai/nvidia.js'
import { chunk, detectType, parseDocument, type SourceType } from './parser.js'

export const CATEGORIES = ['RETURN', 'SHIPPING', 'REFUND', 'WARRANTY', 'MEMBERSHIP', 'MANUAL', 'SELLER', 'SLA', 'CANCELLATION'] as const
export const TIERS = ['BASIC', 'PRIME', 'PREMIUM'] as const
export const REGIONS = ['GLOBAL', 'IN-WEST', 'IN-NORTH', 'IN-SOUTH', 'IN-EAST'] as const
const MAX_BYTES = 20 * 1024 * 1024

export interface DocMetadata {
  title: string
  category: string
  version: string
  effectiveDate: string // YYYY-MM-DD
  region: string
  tiers: string[]
}

function validate(m: DocMetadata, fileName: string, content: Buffer) {
  if (!content?.length) throw badRequest('The file is empty')
  if (content.length > MAX_BYTES) throw badRequest('Files must be 20 MB or smaller')
  if (!m.title?.trim() || m.title.length > 200) throw badRequest('Title is required (max 200 characters)')
  if (!/^[0-9A-Za-z.-]{1,20}$/.test(m.version?.trim() ?? '')) throw badRequest('Version must be like 2026.1')
  if (!(CATEGORIES as readonly string[]).includes(m.category)) throw badRequest(`Unknown category ${m.category}`)
  if (!(REGIONS as readonly string[]).includes(m.region)) throw badRequest(`Unknown region ${m.region}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.effectiveDate)) throw badRequest('effectiveDate must be YYYY-MM-DD')
  if (!m.tiers.length || !m.tiers.every((t) => (TIERS as readonly string[]).includes(t))) throw badRequest('Tiers must be BASIC, PRIME and/or PREMIUM')
  let type: SourceType
  try {
    type = detectType(fileName)
  } catch (e) {
    throw badRequest((e as Error).message)
  }
  if (type === 'PDF' && content.subarray(0, 4).toString('latin1') !== '%PDF') throw badRequest('File does not look like a PDF')
  return type
}

/**
 * Upload → store → parse → chunk → embed → index → activate. Processing continues off the request
 * unless `sync`; the document status (UPLOADED, PROCESSING, READY, FAILED) is what the admin UI polls.
 */
export async function submitDocument(meta: DocMetadata, fileName: string, content: Buffer, uploadedBy: string | null, sync: boolean) {
  const type = validate(meta, fileName, content)
  const checksum = createHash('sha256').update(content).digest('hex')
  const dup = await PolicyDocument.findOne({ checksum }).lean()
  if (dup) throw new ApiError(409, 'DUPLICATE_DOCUMENT', `This file is already uploaded as '${dup.title}' v${dup.version}`)
  if (await PolicyDocument.exists({ title: new RegExp(`^${meta.title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), version: meta.version.trim() })) {
    throw new ApiError(409, 'VERSION_EXISTS', `'${meta.title}' version ${meta.version} already exists — use a new version number`)
  }
  mkdirSync(config.KNOWLEDGE_STORAGE_DIR, { recursive: true })
  const storagePath = path.join(config.KNOWLEDGE_STORAGE_DIR, `${checksum}${path.extname(fileName).toLowerCase()}`)
  if (!existsSync(storagePath)) writeFileSync(storagePath, content)

  const doc = await PolicyDocument.create({
    title: meta.title.trim(),
    category: meta.category as (typeof CATEGORIES)[number],
    region: meta.region,
    version: meta.version.trim(),
    effectiveDate: meta.effectiveDate,
    tiers: meta.tiers,
    sourceType: type,
    fileName,
    storagePath,
    checksum,
    uploadedBy,
  })
  const work = process(String(doc._id), meta, type, content)
  if (sync) await work
  else void work
  return String(doc._id)
}

export async function reprocess(id: string) {
  const doc = await PolicyDocument.findById(id).lean()
  if (!doc) throw notFound('Document not found')
  let content: Buffer
  try {
    content = readFileSync(doc.storagePath)
  } catch {
    throw new ApiError(409, 'FILE_MISSING', 'Stored file is no longer available — upload it again')
  }
  void process(id, { title: doc.title, category: doc.category, version: doc.version, effectiveDate: doc.effectiveDate, region: doc.region, tiers: doc.tiers }, doc.sourceType as SourceType, content)
}

async function process(id: string, meta: DocMetadata, type: SourceType, content: Buffer) {
  const t0 = Date.now()
  try {
    await PolicyDocument.updateOne({ _id: id }, { status: 'PROCESSING', errorMessage: null })
    const sections = await parseDocument(content, type, meta.title)
    const chunks = chunk(meta.title, meta.version, sections)
    // embeddings are optional here: without them the chunks are still searchable by keyword,
    // and embedMissingChunks() fills them in on the next start
    const vectors = nvidiaConfigured()
      ? await embedMany(chunks.map((c) => c.content), 'passage').catch((e) => {
          logger.warn({ id, err: (e as Error).message }, 'chunk embedding failed; stored for keyword search')
          return null
        })
      : null
    await PolicyChunk.deleteMany({ document: id })
    await PolicyChunk.insertMany(
      chunks.map((c, i) => ({
        document: id,
        documentTitle: meta.title,
        section: c.section,
        version: meta.version,
        effectiveDate: meta.effectiveDate,
        category: meta.category,
        region: meta.region,
        tiers: meta.tiers,
        chunkIndex: c.index,
        active: false,
        content: c.content,
        body: c.body,
        ...(vectors && { embedding: vectors[i] }),
      })),
    )
    await PolicyDocument.updateOne(
      { _id: id },
      { status: 'READY', chunkCount: chunks.length, errorMessage: nvidiaConfigured() ? null : 'Indexed for keyword search; add NVIDIA_API_KEY for semantic search' },
    )
    await refreshActiveVersion(meta.title)
    logger.info({ title: meta.title, version: meta.version, sections: sections.length, chunks: chunks.length, ms: Date.now() - t0 }, 'ingested document')
  } catch (e) {
    logger.warn({ id, err: (e as Error).message }, 'ingestion failed')
    await PolicyDocument.updateOne({ _id: id }, { status: 'FAILED', errorMessage: (e as Error).message })
  }
}

/** Exactly one version per title is active: the READY one with the latest effective date already in force. */
export async function refreshActiveVersion(title: string) {
  const today = new Date().toISOString().slice(0, 10)
  const docs = await PolicyDocument.find({ title }).lean()
  const winner = docs
    .filter((d) => d.status === 'READY' && d.effectiveDate <= today)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || +(b as never as { createdAt: Date }).createdAt - +(a as never as { createdAt: Date }).createdAt)[0]
  for (const d of docs) {
    const active = winner ? String(d._id) === String(winner._id) : false
    await PolicyDocument.updateOne({ _id: d._id }, { active })
    await PolicyChunk.updateMany({ document: d._id }, { active })
  }
}

/** Embeds chunks indexed before an NVIDIA key was configured. */
export async function embedMissingChunks() {
  if (!nvidiaConfigured()) return 0
  let total = 0
  for (;;) {
    const batch = await PolicyChunk.find({ embedding: { $exists: false } }).limit(32).lean()
    if (!batch.length) return total
    const vectors = await embedMany(batch.map((c) => c.content), 'passage')
    await PolicyChunk.bulkWrite(batch.map((c, i) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { embedding: vectors[i] } } } })))
    total += batch.length
  }
}

/** Ingests seed/knowledge/manifest.json through the same pipeline as admin uploads, once. */
export async function seedKnowledge(seedDir: string) {
  if ((await PolicyDocument.estimatedDocumentCount()) > 0) return
  const dir = path.join(seedDir, 'knowledge')
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as (DocMetadata & { file: string })[]
  for (const m of manifest) await submitDocument(m, m.file, readFileSync(path.join(dir, m.file)), null, true)
  logger.info({ documents: manifest.length }, 'seeded knowledge documents')
}
