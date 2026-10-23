import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-ink-muted">This page doesn’t exist yet or was moved.</p>
      <Link to="/" className="mt-6 inline-block rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover">
        Back to home
      </Link>
    </div>
  )
}
