import { Router } from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { z } from 'zod'
import { requireUser, staffOnly } from '../http/auth.js'
import { badRequest, handler, notFound, parse } from '../http/errors.js'
import { PolicyChunk, PolicyDocument } from '../models/index.js'
import { checkRateLimit } from '../ai/rate-limit.js'
import { answerQuestion } from './answer.js'
import { reprocess, submitDocument } from './ingestion.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } })

const askSchema = z.object({
  question: z.string().trim().min(1, 'must not be blank').max(500),
  productId: z.string().max(20).nullish(),
  conversationId: z.string().max(64).nullish(),
})

export const knowledgeRouter = Router()

/** Module 2 contract: {answer, confidence, sources, followUpRequired}. */
knowledgeRouter.post(
  '/api/ai/knowledge/ask',
  handler(async (req, res) => {
    const body = parse(askSchema, req.body)
    await checkRateLimit(req)
    res.json(await answerQuestion(body.question, body.productId ?? null, body.conversationId ?? null, req.user ?? null, () => {}))
  }),
)

/** Opens a cited section. */
knowledgeRouter.get(
  '/api/ai/knowledge/chunks/:id',
  handler(async (req, res) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) throw notFound('Source not found')
    const c = await PolicyChunk.findById(id).lean()
    if (!c) throw notFound('Source not found')
    const doc = await PolicyDocument.findById(c.document).lean()
    if (!doc) throw notFound('Source not found')
    res.json({ chunkId: id, documentId: String(doc._id), document: doc.title, section: c.section, version: doc.version, effectiveDate: doc.effectiveDate, category: doc.category, active: doc.active, text: c.body })
  }),
)

const docJson = (d: Record<string, any>) => ({
  id: String(d._id),
  title: d.title,
  category: d.category,
  region: d.region,
  version: d.version,
  effectiveDate: d.effectiveDate,
  tiers: d.tiers,
  sourceType: d.sourceType,
  fileName: d.fileName,
  status: d.status,
  errorMessage: d.errorMessage,
  chunkCount: d.chunkCount,
  active: d.active,
  createdAt: d.createdAt,
})

knowledgeRouter.get(
  '/api/admin/documents',
  staffOnly,
  handler(async (_req, res) => {
    res.json((await PolicyDocument.find().sort({ title: 1, effectiveDate: -1, createdAt: -1 }).lean()).map(docJson))
  }),
)

knowledgeRouter.get(
  '/api/admin/documents/:id',
  staffOnly,
  handler(async (req, res) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) throw notFound('Document not found')
    const doc = await PolicyDocument.findById(id).lean()
    if (!doc) throw notFound('Document not found')
    const chunks = await PolicyChunk.find({ document: id }).sort({ chunkIndex: 1 }).select('+embedding').lean()
    res.json({
      document: docJson(doc),
      chunks: chunks.map((c) => ({ id: String(c._id), content: c.content, metadata: { section: c.section, chunkIndex: c.chunkIndex }, embedded: Array.isArray(c.embedding) && c.embedding.length > 0 })),
    })
  }),
)

knowledgeRouter.post(
  '/api/admin/documents',
  staffOnly,
  upload.single('file'),
  handler(async (req, res) => {
    if (!req.file) throw badRequest('Attach a file in the "file" field')
    const b = req.body as Record<string, string>
    const tiers = String(b.tiers ?? 'BASIC,PRIME,PREMIUM').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    const id = await submitDocument(
      { title: String(b.title ?? ''), category: String(b.category ?? '').toUpperCase(), version: String(b.version ?? ''), effectiveDate: String(b.effectiveDate ?? ''), region: String(b.region ?? 'GLOBAL').toUpperCase(), tiers },
      req.file.originalname,
      req.file.buffer,
      requireUser(req).id,
      false,
    )
    res.status(202).json({ id, status: 'PROCESSING' })
  }),
)

knowledgeRouter.post(
  '/api/admin/documents/:id/reprocess',
  staffOnly,
  handler(async (req, res) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) throw notFound('Document not found')
    await reprocess(id)
    res.status(202).json({ id, status: 'PROCESSING' })
  }),
)
