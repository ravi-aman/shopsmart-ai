import { config } from '../config.js'
import { logger } from '../logger.js'
import { advance, ordersDueForAdvance } from '../orders/service.js'
import { runExpiryJob } from '../expiry/job.js'

let started = false
const timers: NodeJS.Timeout[] = []

/**
 * Background jobs. Started once per process (guard against hot reload double-starts); each job is
 * idempotent, so overlapping runs across instances can't apply a discount or send an offer twice.
 * Run with JOBS_ENABLED=false on all but one instance in a multi-instance deployment.
 */
export function startJobs() {
  if (started || !config.JOBS_ENABLED) return
  started = true

  if (config.SIMULATOR_ENABLED) {
    let busy = false
    timers.push(
      setInterval(async () => {
        if (busy) return
        busy = true
        try {
          for (const id of await ordersDueForAdvance(config.SIMULATOR_STEP_SECONDS)) await advance(id).catch((e) => logger.warn({ id, err: e.message }, 'simulator advance failed'))
        } finally {
          busy = false
        }
      }, config.SIMULATOR_TICK_MS),
    )
  }

  let expiryBusy = false
  const expiry = async () => {
    if (expiryBusy) return
    expiryBusy = true
    try {
      const r = await runExpiryJob()
      logger.info(r, 'expiry job finished')
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'expiry job failed')
    } finally {
      expiryBusy = false
    }
  }
  timers.push(setTimeout(expiry, 10_000))
  timers.push(setInterval(expiry, config.EXPIRY_JOB_INTERVAL_MS))
  logger.info({ simulator: config.SIMULATOR_ENABLED, expiryEveryMs: config.EXPIRY_JOB_INTERVAL_MS }, 'background jobs started')
}

export function stopJobs() {
  timers.forEach((t) => clearInterval(t))
}
