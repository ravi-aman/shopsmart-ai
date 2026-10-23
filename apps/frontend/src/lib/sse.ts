import { ApiError, type ApiProblem } from '@/lib/api'
import { useAuth } from '@/features/auth/authStore'

/**
 * POSTs JSON and reads a text/event-stream response (EventSource only supports GET).
 * Calls onEvent for every complete `event:`/`data:` block.
 */
export async function postSse(
  path: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const token = useAuth.getState().token
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) {
    let problem: ApiProblem = { status: res.status }
    try {
      problem = { ...problem, ...(await res.json()) }
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && token) useAuth.getState().signOut()
    throw new ApiError(problem)
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value.replace(/\r\n/g, '\n')
    let split: number
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) {
        const raw = data.join('\n')
        let parsed: unknown = raw
        try {
          parsed = JSON.parse(raw)
        } catch {
          /* plain text payload */
        }
        onEvent(event, parsed)
      }
    }
  }
}
