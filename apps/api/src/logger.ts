import pino from 'pino'

/** Structured JSON logs; pretty-printed in development when pino-pretty is installed. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['req.headers.authorization', 'password', '*.password', '*.passwordHash', 'apiKey'], remove: true },
  ...(process.env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
})
