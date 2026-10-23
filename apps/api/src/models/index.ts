import mongoose, { type InferSchemaType, Schema } from 'mongoose'

/**
 * All persistence models. Products, categories, warehouses and orders use readable string ids
 * (LAP101, laptops, WH-MUM, ORD-100001) because they appear in URLs, citations and the audit log.
 */
const opts = { timestamps: true, versionKey: false } as const

const point = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
)

// ------------------------------------------------------------------ identity

export const ROLES = ['CUSTOMER', 'ADMIN', 'OPS', 'PARTNER'] as const
export const TIERS = ['BASIC', 'PRIME', 'PREMIUM'] as const
export const REGIONS = ['IN-WEST', 'IN-NORTH', 'IN-SOUTH', 'IN-EAST'] as const

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'CUSTOMER' },
    membershipTier: { type: String, enum: TIERS, default: 'BASIC' },
    premiumUntil: { type: Date, default: null },
    region: { type: String, enum: REGIONS, default: 'IN-WEST' },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    partner: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    preferences: {
      preferredCategories: { type: [String], default: [] },
      preferredBrands: { type: [String], default: [] },
      useCases: { type: [String], default: [] },
      budgetMin: { type: Number, default: null },
      budgetMax: { type: Number, default: null },
    },
    /** Optional, user-provided, used only for size suggestions. */
    measurements: {
      chestCm: { type: Number, default: null },
      waistCm: { type: Number, default: null },
      footLengthCm: { type: Number, default: null },
    },
    notificationPrefs: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
    },
  },
  opts,
)
export const User = mongoose.model('User', userSchema)
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId; createdAt: Date }

// ------------------------------------------------------------------ catalog

const categorySchema = new Schema(
  {
    _id: { type: String }, // slug
    name: { type: String, required: true },
    parent: { type: String, default: null },
    path: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { versionKey: false },
)
export const Category = mongoose.model('Category', categorySchema)

const productSchema = new Schema(
  {
    _id: { type: String }, // e.g. LAP101
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    brand: { type: String, required: true, index: true },
    category: { type: String, required: true, ref: 'Category' },
    categoryName: { type: String, required: true },
    categoryPath: { type: String, required: true, index: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, default: null },
    currency: { type: String, default: 'USD' },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    images: { type: [String], default: [] },
    specs: { type: Schema.Types.Mixed, default: {} },
    tags: { type: [String], default: [] },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    perishable: { type: Boolean, default: false },
    storage: { type: String, enum: ['AMBIENT', 'CHILLED', 'FROZEN'], default: 'AMBIENT' },
    /** Manufacturer size chart for fit suggestions: size → { chestCm?, waistCm?, footLengthCm? } */
    sizeChart: { type: Schema.Types.Mixed, default: null },
    embedding: { type: [Number], default: undefined, select: false },
  },
  opts,
)
productSchema.index({ name: 'text', brand: 'text', tags: 'text', description: 'text' }, { weights: { name: 10, brand: 6, tags: 5, description: 1 }, name: 'product_text' })
productSchema.index({ categoryPath: 1, price: 1 })
export const Product = mongoose.model('Product', productSchema)

const warehouseSchema = new Schema(
  {
    _id: { type: String }, // WH-MUM
    name: { type: String, required: true },
    city: { type: String, required: true },
    region: { type: String, enum: REGIONS, required: true },
    location: { type: point, required: true },
  },
  { versionKey: false },
)
export const Warehouse = mongoose.model('Warehouse', warehouseSchema)

const inventorySchema = new Schema(
  {
    product: { type: String, ref: 'Product', required: true },
    warehouse: { type: String, ref: 'Warehouse', required: true },
    onHand: { type: Number, required: true, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    reorderPoint: { type: Number, default: 5 },
  },
  opts,
)
inventorySchema.index({ product: 1, warehouse: 1 }, { unique: true })
export const Inventory = mongoose.model('Inventory', inventorySchema)

export const MOVEMENT_REASONS = ['SALE', 'RESTOCK', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'CANCELLATION', 'EXPIRED', 'DONATION'] as const
const movementSchema = new Schema(
  {
    product: { type: String, required: true },
    warehouse: { type: String, required: true },
    batch: { type: Schema.Types.ObjectId, default: null },
    delta: { type: Number, required: true },
    reason: { type: String, enum: MOVEMENT_REASONS, required: true },
    actor: { type: String, default: 'system' },
    ref: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
)
movementSchema.index({ product: 1, warehouse: 1, at: -1 })
movementSchema.index({ reason: 1, at: -1 })
export const StockMovement = mongoose.model('StockMovement', movementSchema)

/** A dated lot of a perishable product at one centre. Expiry discounts and partner offers work per batch. */
const batchSchema = new Schema(
  {
    product: { type: String, ref: 'Product', required: true },
    warehouse: { type: String, ref: 'Warehouse', required: true },
    batchNo: { type: String, required: true },
    quantityReceived: { type: Number, required: true, min: 0 },
    quantityAvailable: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['ACTIVE', 'DISCOUNTED', 'OFFERED', 'TRANSFERRED', 'EXPIRED', 'RECALLED', 'SOLD_OUT'], default: 'ACTIVE' },
    discountPercent: { type: Number, default: 0 },
    discountTierDays: { type: Number, default: null }, // which rule tier is applied (idempotency)
    discountHistory: { type: [{ percent: Number, at: Date, reason: String }], default: [] },
  },
  opts,
)
batchSchema.index({ batchNo: 1 }, { unique: true })
batchSchema.index({ status: 1, expiresAt: 1 })
batchSchema.index({ product: 1, warehouse: 1 })
export const InventoryBatch = mongoose.model('InventoryBatch', batchSchema)

/** Discount tiers by days left: e.g. ≤3 days → 30%, ≤1 day → 50%. */
const expiryRuleSchema = new Schema(
  {
    category: { type: String, required: true, unique: true }, // category slug or '*'
    tiers: { type: [{ daysLeft: Number, percent: Number }], required: true },
    offerToPartnersDaysLeft: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
  },
  opts,
)
export const ExpiryRule = mongoose.model('ExpiryRule', expiryRuleSchema)

// ------------------------------------------------------------------ shopping

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: {
      type: [{ product: { type: String, required: true }, quantity: { type: Number, required: true, min: 1, max: 20 }, priceSnapshot: Number, addedAt: { type: Date, default: () => new Date() } }],
      default: [],
    },
  },
  opts,
)
export const Cart = mongoose.model('Cart', cartSchema)

const wishlistSchema = new Schema({ user: { type: Schema.Types.ObjectId, required: true }, product: { type: String, required: true } }, opts)
wishlistSchema.index({ user: 1, product: 1 }, { unique: true })
export const Wishlist = mongoose.model('Wishlist', wishlistSchema)

export const ORDER_STATUSES = ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED', 'REFUNDED'] as const
const orderSchema = new Schema(
  {
    _id: { type: String }, // ORD-100001
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'PLACED', index: true },
    items: {
      type: [
        {
          _id: false,
          product: String,
          name: String,
          slug: String,
          image: String,
          brand: String,
          category: String,
          categoryName: String,
          categoryPath: String,
          quantity: Number,
          unitPrice: Number,
          discount: { type: Number, default: 0 },
          /** Which dated batches (FEFO) supplied a perishable line, and at what clearance discount. */
          allocations: { type: [{ _id: false, batch: Schema.Types.ObjectId, quantity: Number, discountPercent: Number }], default: [] },
        },
      ],
      required: true,
    },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    promotionCodes: { type: [String], default: [] },
    shippingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    address: { name: String, line1: String, city: String, pincode: String, region: String, phone: String },
    warehouse: { type: String, ref: 'Warehouse' },
    promisedDate: { type: String }, // YYYY-MM-DD
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    paymentStatus: { type: String, enum: ['SIMULATED_PAID', 'REFUND_PENDING', 'REFUNDED'], default: 'SIMULATED_PAID' },
    shipment: {
      id: String,
      carrier: String,
      trackingNo: String,
      eta: String,
      delayed: { type: Boolean, default: false },
      events: { type: [{ _id: false, status: String, location: String, note: String, at: Date }], default: [] },
    },
    returns: {
      type: [{ product: String, reason: String, status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED'], default: 'REQUESTED' }, policy: Schema.Types.Mixed, createdAt: Date }],
      default: [],
    },
  },
  opts,
)
orderSchema.index({ user: 1, createdAt: -1 })
orderSchema.index({ status: 1, 'shipment.delayed': 1 })
export const Order = mongoose.model('Order', orderSchema)

const promotionSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    type: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
    value: { type: Number, required: true, min: 0 },
    product: { type: String, default: null, index: true },
    category: { type: String, default: null },
    minSubtotal: { type: Number, default: 0 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'ENDED'], default: 'DRAFT' },
    createdBy: { type: String, enum: ['HUMAN', 'AGENT', 'EXPIRY_JOB'], default: 'HUMAN' },
    rationale: { type: String, default: null },
  },
  opts,
)
export const Promotion = mongoose.model('Promotion', promotionSchema)

const stockRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: String, ref: 'Product', required: true },
    status: { type: String, enum: ['ACTIVE', 'NOTIFIED', 'CANCELLED'], default: 'ACTIVE' },
    notifiedAt: { type: Date, default: null },
  },
  opts,
)
// one active request per user and product
stockRequestSchema.index({ user: 1, product: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } })
stockRequestSchema.index({ product: 1, status: 1 })
export const StockRequest = mongoose.model('StockRequest', stockRequestSchema)

// ------------------------------------------------------------------ notifications & support

export const NOTIFICATION_TYPES = ['RESTOCK', 'ORDER_STATUS', 'NEAR_EXPIRY', 'DISCOUNT', 'SUPPORT', 'RETURN_STATUS', 'PARTNER_OFFER', 'ADMIN_WARNING'] as const
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: { type: String, default: null },
    read: { type: Boolean, default: false },
    dedupeKey: { type: String, default: null },
    email: { status: { type: String, enum: ['NOT_SENT', 'SENT', 'FAILED', 'SKIPPED'], default: 'NOT_SENT' }, at: Date, error: String },
  },
  opts,
)
notificationSchema.index({ user: 1, read: 1, createdAt: -1 })
notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } })
export const Notification = mongoose.model('Notification', notificationSchema)

const supportCaseSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: String, default: null },
    subject: { type: String, required: true, maxlength: 200 },
    status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], default: 'OPEN', index: true },
    priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH'], default: 'NORMAL' },
    source: { type: String, enum: ['USER', 'AI_FOLLOW_UP'], default: 'USER' },
    aiDecision: { type: Schema.Types.ObjectId, default: null },
    messages: { type: [{ from: { type: String, enum: ['USER', 'AGENT', 'SYSTEM'] }, author: String, text: String, at: Date }], default: [] },
  },
  opts,
)
export const SupportCase = mongoose.model('SupportCase', supportCaseSchema)

// ------------------------------------------------------------------ partners (NGO / cold storage)

const partnerSchema = new Schema(
  {
    name: { type: String, required: true },
    kind: { type: String, enum: ['NGO', 'COLD_STORAGE'], required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String, default: null },
    location: { type: point, required: true },
    address: { type: String, default: '' },
    supportedCategories: { type: [String], default: [] }, // category slugs
    storage: { type: [String], enum: ['AMBIENT', 'CHILLED', 'FROZEN'], default: ['AMBIENT'] },
    capacityUnits: { type: Number, default: 100 },
    verified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  opts,
)
partnerSchema.index({ location: '2dsphere' })
export const Partner = mongoose.model('Partner', partnerSchema)

const expiryOfferSchema = new Schema(
  {
    batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch', required: true },
    product: { type: String, ref: 'Product', required: true },
    warehouse: { type: String, required: true },
    partner: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    quantity: { type: Number, required: true, min: 1 },
    distanceMeters: { type: Number, required: true },
    status: { type: String, enum: ['OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'PICKED_UP', 'TRANSFERRED', 'CANCELLED'], default: 'OFFERED' },
    offerExpiresAt: { type: Date, required: true },
    transferredQuantity: { type: Number, default: null },
    email: { status: { type: String, enum: ['NOT_SENT', 'SENT', 'FAILED', 'SKIPPED'], default: 'NOT_SENT' }, at: Date, error: String },
    history: { type: [{ status: String, at: Date, by: String, note: String }], default: [] },
  },
  opts,
)
// one open offer per batch and partner — the job can run repeatedly without re-offering
expiryOfferSchema.index({ batch: 1, partner: 1 }, { unique: true })
expiryOfferSchema.index({ partner: 1, status: 1 })
export const ExpiryOffer = mongoose.model('ExpiryOffer', expiryOfferSchema)

// ------------------------------------------------------------------ knowledge (RAG)

const policyDocSchema = new Schema(
  {
    title: { type: String, required: true },
    category: { type: String, enum: ['RETURN', 'SHIPPING', 'REFUND', 'WARRANTY', 'MEMBERSHIP', 'MANUAL', 'SELLER', 'SLA', 'CANCELLATION'], required: true },
    region: { type: String, default: 'GLOBAL' },
    version: { type: String, required: true },
    effectiveDate: { type: String, required: true }, // YYYY-MM-DD
    tiers: { type: [String], default: ['BASIC', 'PRIME', 'PREMIUM'] },
    sourceType: { type: String, enum: ['PDF', 'MARKDOWN', 'JSON'], required: true },
    fileName: { type: String, required: true },
    storagePath: { type: String, required: true },
    checksum: { type: String, required: true, unique: true },
    status: { type: String, enum: ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'], default: 'UPLOADED' },
    errorMessage: { type: String, default: null },
    chunkCount: { type: Number, default: 0 },
    active: { type: Boolean, default: false },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
  },
  opts,
)
policyDocSchema.index({ title: 1, version: 1 }, { unique: true })
export const PolicyDocument = mongoose.model('PolicyDocument', policyDocSchema)

const chunkSchema = new Schema(
  {
    document: { type: Schema.Types.ObjectId, ref: 'PolicyDocument', required: true, index: true },
    documentTitle: { type: String, required: true },
    section: { type: String, required: true },
    version: { type: String, required: true },
    effectiveDate: { type: String, required: true },
    category: { type: String, required: true },
    region: { type: String, required: true },
    tiers: { type: [String], required: true },
    chunkIndex: { type: Number, required: true },
    active: { type: Boolean, default: false, index: true },
    content: { type: String, required: true }, // header + body, what gets embedded
    body: { type: String, required: true },
    embedding: { type: [Number], default: undefined, select: false },
  },
  opts,
)
chunkSchema.index({ content: 'text', section: 'text' }, { weights: { section: 3, content: 1 }, name: 'chunk_text' })
export const PolicyChunk = mongoose.model('PolicyChunk', chunkSchema)

// ------------------------------------------------------------------ AI audit & admin audit

const aiAuditSchema = new Schema(
  {
    conversationId: { type: String, default: null },
    user: { type: Schema.Types.ObjectId, default: null, index: true },
    agent: { type: String, enum: ['SHOPPING', 'KNOWLEDGE', 'ORDER', 'OPS', 'CHECKOUT', 'PREMIUM'], required: true },
    intent: { type: String, required: true },
    input: { type: String, required: true },
    extractedParams: { type: Schema.Types.Mixed, default: null },
    toolCalls: { type: Schema.Types.Mixed, default: [] },
    retrievedIds: { type: [String], default: [] },
    output: { type: Schema.Types.Mixed, default: null },
    confidence: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW', null], default: null },
    model: { type: String, default: null },
    promptTokens: { type: Number, default: null },
    completionTokens: { type: Number, default: null },
    estimatedCostUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, required: true },
    error: { type: String, default: null },
    humanApproved: { type: Boolean, default: null },
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } },
)
aiAuditSchema.index({ createdAt: -1 })
aiAuditSchema.index({ agent: 1, createdAt: -1 })
export const AiAudit = mongoose.model('AiAudit', aiAuditSchema)

const aiFeedbackSchema = new Schema(
  { audit: { type: Schema.Types.ObjectId, required: true }, user: { type: Schema.Types.ObjectId, required: true }, rating: { type: Number, enum: [1, -1] }, comment: String },
  opts,
)
aiFeedbackSchema.index({ audit: 1, user: 1 }, { unique: true })
export const AiFeedback = mongoose.model('AiFeedback', aiFeedbackSchema)

/** Sensitive administrative operations (stock changes, rule edits, partner verification…). */
const adminAuditSchema = new Schema(
  {
    actor: { type: String, required: true },
    action: { type: String, required: true },
    target: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } },
)
adminAuditSchema.index({ createdAt: -1 })
export const AdminAudit = mongoose.model('AdminAudit', adminAuditSchema)

const counterSchema = new Schema({ _id: String, seq: Number }, { versionKey: false })
export const Counter = mongoose.model('Counter', counterSchema)

/** Atomic, gap-tolerant sequence (order numbers). */
export async function nextSequence(name: string, start = 100000): Promise<number> {
  await Counter.updateOne({ _id: name }, { $setOnInsert: { seq: start } }, { upsert: true })
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true })
  return c!.seq as number
}
