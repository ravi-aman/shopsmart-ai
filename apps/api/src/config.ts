import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (MongoDB Atlas or local replica set)'),
  MONGODB_DB: z.string().default('shopsmart'),

  NVIDIA_API_KEY: z.string().default(''),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com'),
  NVIDIA_AGENT_MODEL: z.string().default('nvidia/nemotron-3-super-120b-a12b'),
  NVIDIA_FAST_MODEL: z.string().default('nvidia/nemotron-3.5-lightning-30b-a3b'),
  NVIDIA_MAX_TOKENS: z.coerce.number().int().default(2048),
  NVIDIA_EMBEDDING_MODEL: z.string().default('nvidia/embed-qa-4'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().default(1024),
  EMBEDDING_SEND_DIMENSIONS: bool.default(false),
  AI_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  /** Illustrative pricing for the AI cost estimate (USD per 1M tokens) — not a bill. */
  AI_INPUT_COST_PER_1M: z.coerce.number().default(0.1),
  AI_OUTPUT_COST_PER_1M: z.coerce.number().default(0.4),
  INR_PER_USD: z.coerce.number().positive().default(83),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(15),
  AI_DAILY_LIMIT_BASIC: z.coerce.number().int().default(50),
  AI_DAILY_LIMIT_PREMIUM: z.coerce.number().int().default(300),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_MINUTES: z.coerce.number().int().default(720),
  DEMO_USER_PASSWORD: z.string().default('ShopSmart@2026'),
  DEV_ENDPOINTS_ENABLED: bool.default(false),

  SIMULATOR_ENABLED: bool.default(true),
  SIMULATOR_STEP_SECONDS: z.coerce.number().int().default(180),
  SIMULATOR_TICK_MS: z.coerce.number().int().default(30_000),
  JOBS_ENABLED: bool.default(true),
  EXPIRY_JOB_INTERVAL_MS: z.coerce.number().int().default(15 * 60_000),
  PARTNER_RADIUS_METERS: z.coerce.number().int().default(3000),
  PARTNER_OFFER_HOURS: z.coerce.number().int().default(12),

  KNOWLEDGE_STORAGE_DIR: z.string().default('storage/knowledge'),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default('ShopSmart <no-reply@shopsmart.dev>'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  console.error(`Invalid configuration (check the repo-root .env):\n${issues}`)
  process.exit(1)
}

export const config = parsed.data

/** False when no real NVIDIA key is configured; every AI feature then uses its deterministic fallback. */
export function nvidiaConfigured() {
  const key = config.NVIDIA_API_KEY
  return key.length > 0 && key !== 'missing-key' && !key.startsWith('nvapi-xxxx')
}

export const smtpConfigured = () => config.SMTP_HOST.length > 0
