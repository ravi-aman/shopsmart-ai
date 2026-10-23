import cors from 'cors'
import express, { type Router } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { aiRouter } from './ai/routes.js'
import { config } from './config.js'
import { authenticate } from './http/auth.js'
import { errorMiddleware, problem } from './http/errors.js'
import { logger } from './logger.js'
import { cartRouter } from './modules/cart.js'
import { catalogRouter } from './modules/catalog/routes.js'
import { customerRouter } from './modules/customer.js'
import { healthRouter } from './modules/health.js'
import { knowledgeRouter } from './knowledge/routes.js'
import { expiryRouter } from './expiry/routes.js'
import { assistantRouter } from './ai/assistant.js'
import { opsRouter } from './ops/routes.js'
import { supportRouter } from './support/routes.js'
import { notificationsRouter } from './notifications/routes.js'
import { ordersRouter } from './orders/routes.js'

export function createApp(extraRouters: Router[] = []) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }))
  app.use(cors({ origin: config.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()), exposedHeaders: ['Location'] }))
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' }, customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info') }))
  app.use(express.json({ limit: '1mb' }))
  app.use(authenticate)

  for (const r of [healthRouter, customerRouter, catalogRouter, cartRouter, aiRouter, assistantRouter, knowledgeRouter, ordersRouter, notificationsRouter, expiryRouter, opsRouter, supportRouter, ...extraRouters]) app.use(r)

  app.use((req, res) => problem(res, req, 404, 'NOT_FOUND', `No endpoint ${req.method} ${req.path}`))
  app.use(errorMiddleware)
  return app
}
