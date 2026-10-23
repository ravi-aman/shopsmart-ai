import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/features/auth/authStore'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { postSse } from '@/lib/sse'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** Header bell: live over SSE, with a slow poll as a fallback when the stream drops. */
export function NotificationBell() {
  const token = useAuth((s) => s.token)
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; items: Notification[] }>('/api/notifications'),
    enabled: !!token,
    refetchInterval: 60_000,
  })
  const read = useMutation({
    mutationFn: (id: string | null) => api(id ? `/api/notifications/${id}/read` : '/api/notifications/read-all', { method: id ? 'PATCH' : 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  useEffect(() => {
    if (!token) return
    const ctrl = new AbortController()
    postSse('/api/notifications/stream', {}, (event) => {
      if (event === 'notification') qc.invalidateQueries({ queryKey: ['notifications'] })
    }, ctrl.signal).catch(() => {})
    return () => ctrl.abort()
  }, [token, qc])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!token) return null
  const unread = list.data?.unread ?? 0

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative grid size-10 place-items-center rounded-md hover:bg-white/10">
        <Bell className="size-5" aria-hidden />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line bg-surface text-ink shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => read.mutate(null)} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                <CheckCheck className="size-3.5" aria-hidden /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {list.data?.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-muted">You’re all caught up.</li>}
            {list.data?.items.map((n) => {
              const body = (
                <>
                  <p className={cn('text-sm', !n.read && 'font-semibold')}>{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>
                  <p className="mt-1 text-[11px] text-ink-subtle">{ago(n.createdAt)}</p>
                </>
              )
              const onClick = () => {
                if (!n.read) read.mutate(n.id)
                setOpen(false)
              }
              return (
                <li key={n.id} className={cn('relative', !n.read && 'bg-accent-soft/40')}>
                  {!n.read && <span className="absolute left-1.5 top-4 size-1.5 rounded-full bg-accent" aria-hidden />}
                  {n.link ? (
                    <Link to={n.link} onClick={onClick} className="block px-4 py-3 hover:bg-canvas">{body}</Link>
                  ) : (
                    <button type="button" onClick={onClick} className="block w-full px-4 py-3 text-left hover:bg-canvas">{body}</button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
