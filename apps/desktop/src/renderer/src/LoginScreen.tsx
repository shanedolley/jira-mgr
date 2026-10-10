import { useState, type SyntheticEvent } from 'react'

import type { Session } from '../../shared/ipc'
import { useLogin } from './queries'

interface FieldProps {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  placeholder?: string
}

function Field({ label, name, value, onChange, type = 'text', placeholder }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-muted">{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        required
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="w-full rounded-md border border-field-border bg-panel px-2.5 py-1.5 placeholder:text-muted"
      />
    </label>
  )
}

/** Site, project, email and API token, as `jm auth login` asks for them. Settings fill what they hold. */
export function LoginScreen({ prefill }: { prefill: Partial<Session> }) {
  const [siteUrl, setSiteUrl] = useState(prefill.siteUrl ?? '')
  const [projectKey, setProjectKey] = useState(prefill.projectKey ?? '')
  const [email, setEmail] = useState(prefill.email ?? '')
  const [token, setToken] = useState('')
  const login = useLogin()

  function submit(event: SyntheticEvent) {
    event.preventDefault()
    login.mutate({
      siteUrl: siteUrl.trim(),
      projectKey: projectKey.trim(),
      email: email.trim(),
      token,
    })
  }

  return (
    <main className="grid h-full place-items-center bg-canvas p-8">
      <div className="app-drag fixed inset-x-0 top-0 h-10" />
      <form onSubmit={submit} className="w-full max-w-[25rem] space-y-4">
        <header>
          <div className="mb-5 flex items-center gap-2.5">
            <span
              data-login-mark
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold tracking-tight text-accent-ink"
            >
              jm
            </span>
            <span className="text-[15px] font-semibold">jira-mgr</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Log in to Jira</h1>
          <p className="mt-1 text-muted">The token stays in your macOS Keychain.</p>
        </header>
        <Field
          label="Site URL"
          name="siteUrl"
          value={siteUrl}
          onChange={setSiteUrl}
          placeholder="https://your-team.atlassian.net"
        />
        <Field
          label="Project key"
          name="projectKey"
          value={projectKey}
          onChange={setProjectKey}
          placeholder="PSAPAC"
        />
        <Field label="Email" name="email" type="email" value={email} onChange={setEmail} />
        <Field label="API token" name="token" type="password" value={token} onChange={setToken} />
        {login.isError && (
          <p role="alert" className="text-danger">
            {login.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60"
        >
          {login.isPending ? 'Logging in...' : 'Log in'}
        </button>
      </form>
    </main>
  )
}
