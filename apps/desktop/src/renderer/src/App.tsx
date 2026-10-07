import { APP_NAME } from '@jira-mgr/core'

export function App() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <p className="text-sm text-neutral-500">Running on {window.jm.platform}</p>
    </main>
  )
}
