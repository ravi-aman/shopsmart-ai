import type { Response } from 'express'

export interface Step {
  id: string
  label: string
  status: 'running' | 'done'
  durationMs: number | null
}

export type Progress = (step: Step) => void

/** Opens a text/event-stream response (POST-friendly, unlike EventSource) and returns a sender. */
export function openSse(res: Response) {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  let open = true
  res.on('close', () => {
    open = false
  })
  return {
    send(event: string, data: unknown) {
      // the client may have gone away; the work still finishes and is audited
      if (open) res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`)
    },
    end() {
      if (open) res.end()
    },
  }
}

/** Emits running/done steps and keeps a trace for the audit log. */
export class Tracker {
  readonly trace: Record<string, unknown>[] = []
  private id = ''
  private label = ''
  private t0 = 0

  constructor(private readonly progress: Progress) {}

  start(id: string, label: string) {
    this.id = id
    this.label = label
    this.t0 = Date.now()
    this.progress({ id, label, status: 'running', durationMs: null })
  }

  done(detail: Record<string, unknown> = {}) {
    const ms = Date.now() - this.t0
    this.progress({ id: this.id, label: this.label, status: 'done', durationMs: ms })
    this.trace.push({ step: this.id, label: this.label, durationMs: ms, ...detail })
  }
}
