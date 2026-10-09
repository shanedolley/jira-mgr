import { LoginScreen } from './LoginScreen'
import { Shell } from './Shell'
import { useSession } from './queries'

export function App() {
  const session = useSession()

  if (session.isPending) {
    return (
      <p role="status" className="grid h-full place-items-center text-muted">
        Starting...
      </p>
    )
  }
  if (session.isError) {
    return (
      <main className="grid h-full place-items-center p-8">
        <div role="alert" className="max-w-md text-center">
          <h1 className="text-base font-semibold">Cannot read the saved login</h1>
          <p className="mt-2 text-muted">{session.error.message}</p>
          <button
            type="button"
            className="mt-4 rounded-md border border-line px-3 py-1.5 hover:bg-hover"
            onClick={() => void session.refetch()}
          >
            Try again
          </button>
        </div>
      </main>
    )
  }
  return session.data.loggedIn ? (
    <Shell session={session.data.session} />
  ) : (
    <LoginScreen prefill={session.data.prefill} />
  )
}
