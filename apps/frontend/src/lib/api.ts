/** RFC 7807 error body returned by the API. */
export interface ApiProblem {
  status: number
  title?: string
  detail?: string
  code?: string
  fieldErrors?: Record<string, string>
}

export class ApiError extends Error {
  readonly problem: ApiProblem

  constructor(problem: ApiProblem) {
    super(problem.detail ?? problem.title ?? `Request failed (${problem.status})`)
    this.problem = problem
  }
}

let tokenProvider: () => string | null = () => null
let onUnauthorized: () => void = () => {}

/** Wired by the auth store so this module stays free of React/zustand imports. */
export function configureAuth(getToken: () => string | null, handleUnauthorized: () => void) {
  tokenProvider = getToken
  onUnauthorized = handleUnauthorized
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const token = tokenProvider()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })
  if (res.status === 401 && token) onUnauthorized()
  if (!res.ok) {
    let problem: ApiProblem = { status: res.status }
    try {
      problem = { ...problem, ...(await res.json()) }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(problem)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
