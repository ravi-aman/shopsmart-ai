import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { Suggestion } from '@/lib/types'

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** Header search with typeahead (combobox pattern). Remounted per search URL so the text follows ?q=. */
export function SearchBox() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const listId = useId()
  const [text, setText] = useState(location.pathname === '/search' ? (params.get('q') ?? '') : '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapper = useRef<HTMLFormElement>(null)
  const debounced = useDebounced(text.trim(), 180)

  const suggestions = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: () => api<Suggestion[]>(`/api/catalog/suggest?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  })
  const items = debounced.length >= 2 ? (suggestions.data ?? []) : []

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function go(s?: Suggestion) {
    setOpen(false)
    setActive(-1)
    if (s) {
      navigate(s.type === 'category' ? `/c/${s.slug}` : `/p/${s.slug}`)
      return
    }
    const q = text.trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <form
      ref={wrapper}
      role="search"
      className="relative flex min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        go(active >= 0 ? items[active] : undefined)
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        Search products
      </label>
      <input
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={text}
        maxLength={200}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(items.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(-1, a - 1))
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder="Search laptops, phones, books…"
        className="h-10 min-w-0 flex-1 rounded-l-md border-0 bg-white px-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <button type="submit" aria-label="Search" className="grid h-10 w-12 place-items-center rounded-r-md bg-accent hover:bg-accent-hover">
        <Search className="size-5" aria-hidden />
      </button>

      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-line bg-surface py-1 text-sm text-ink shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={s.type + s.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                go(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 px-3 py-2', i === active && 'bg-canvas')}
            >
              {s.type === 'category' ? (
                <LayoutGrid className="size-4 shrink-0 text-ink-subtle" aria-hidden />
              ) : (
                <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
              )}
              <span className="truncate">{s.label}</span>
              {s.type === 'category' && <span className="ml-auto shrink-0 text-xs text-ink-subtle">Category</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
