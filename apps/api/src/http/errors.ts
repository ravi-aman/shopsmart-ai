import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'

/** An error the client can act on; rendered as an RFC 7807 problem with a stable `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message)
export const badRequest = (message: string) => new ApiError(400, 'BAD_REQUEST', message)
export const conflict = (code: string, message: string) => new ApiError(409, code, message)

const titles: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
}

export function problem(res: Response, req: Request, status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
  res.status(status).type('application/problem+json').json({
    type: 'about:blank',
    title: titles[status] ?? 'Error',
    status,
    detail,
    instance: req.originalUrl.split('?')[0],
    code,
    ...extra,
  })
}

/** Parses and validates a request body/query with zod; field errors come back as `fieldErrors`. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fieldErrors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message
  }
  throw new ApiError(400, 'VALIDATION_FAILED', 'Request validation failed', { fieldErrors })
}

/** Wraps async handlers so thrown errors reach the error middleware. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return
  if (err instanceof ApiError) return problem(res, req, err.status, err.code, err.message, err.extra)
  if (err?.type === 'entity.parse.failed') return problem(res, req, 400, 'BAD_REQUEST', 'Malformed JSON body')
  if (err?.code === 'LIMIT_FILE_SIZE') return problem(res, req, 413, 'FILE_TOO_LARGE', 'Files must be 20 MB or smaller')
  console.error('[error] unhandled', err)
  problem(res, req, 500, 'INTERNAL_ERROR', 'Something went wrong')
}
