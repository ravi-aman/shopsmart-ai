import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { departments } from '@/app/categories'
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard'
import { useAssistant } from '@/features/assistant/assistantStore'
import { api } from '@/lib/api'
import type { SearchResponse } from '@/lib/types'

const assistantPrompts = [
  'Suggest a laptop under $1000 for Java development and AI projects',
  'Noise cancelling headphones for travel under $300',
  'A gaming laptop with an RTX GPU under $1200',
]

const rails = [
  { title: 'Laptops for developers', query: 'category=laptops&spec.ramGb=16&inStock=true&sort=rating', link: '/c/laptops?spec.ramGb=16' },
  { title: 'Top-rated smartphones', query: 'category=smartphones&inStock=true&sort=rating', link: '/c/smartphones?sort=rating' },
  { title: 'Books for engineers', query: 'category=books&sort=rating', link: '/c/books' },
]

export function HomePage() {
  const ask = useAssistant((s) => s.ask)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <section className="grid gap-6 rounded-card border border-line bg-surface p-6 md:grid-cols-[1.4fr_1fr] md:p-10">
        <div>
          <p className="text-sm font-medium text-accent">Shop with an assistant that shows its work</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Tell us what you need.
            <br />
            Get products that fit — and why.
          </h1>
          <p className="mt-3 max-w-prose text-ink-muted">
            Recommendations explain the specs behind every pick, with a score breakdown you can check. Every answer is
            logged for review.
          </p>
        </div>
        <ul className="flex flex-col gap-2 self-center">
          {assistantPrompts.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                onClick={() => ask(prompt)}
                className="group flex w-full items-start gap-2 rounded-lg border border-line px-3 py-2.5 text-left text-sm hover:border-ai hover:bg-ai-soft"
              >
                <Sparkles className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden />
                <span className="flex-1">{prompt}</span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-subtle group-hover:text-ai" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Shop by department</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {departments.map((d) => (
            <li key={d.slug}>
              <Link
                to={`/c/${d.slug}`}
                className="block h-full rounded-card border border-line bg-surface p-4 hover:border-line-strong hover:shadow-sm"
              >
                <span className="block font-medium">{d.name}</span>
                <span className="mt-1 block text-xs text-ink-muted">{d.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {rails.map((rail) => (
        <ProductRail key={rail.title} {...rail} />
      ))}
    </div>
  )
}

function ProductRail({ title, query, link }: { title: string; query: string; link: string }) {
  const data = useQuery({
    queryKey: ['products', `${query}&size=5`],
    queryFn: () => api<SearchResponse>(`/api/catalog/products?${query}&size=5`),
  })
  if (data.isError || data.data?.items.length === 0) return null

  return (
    <section className="mt-10">
      <div className="flex items-end justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link to={link} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          See all <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {(data.data?.items ?? Array.from({ length: 5 }, () => null)).map((p, i) => (
          <li key={p?.id ?? i} className={i >= 4 ? 'hidden lg:block' : i >= 3 ? 'hidden md:block' : undefined}>
            {p ? <ProductCard product={p} /> : <ProductCardSkeleton />}
          </li>
        ))}
      </ul>
    </section>
  )
}
