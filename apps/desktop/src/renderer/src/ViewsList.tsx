import type { ViewFilters } from '@jira-mgr/core/view-filter'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { SavedView, Toggles } from '../../shared/ipc'
import { Details, Failure } from './Failure'
import { useCreateView, useDeleteView, useRenameView, useViews } from './viewQueries'
import { activeView } from './views'

interface ViewsListProps {
  /** The filter bar and toggles as they are now: what "New view" saves, and what marks a view active. */
  filters: ViewFilters
  toggles: Toggles | undefined
  onApply: (view: SavedView) => void
}

const ICON_BUTTON =
  'grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-hover hover:text-ink'

function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}

const PLUS = 'M8 3.5v9M3.5 8h9'
const PENCIL = 'm10.5 3.5 2 2-7 7H3.5v-2zM9 5l2 2'
const TRASH = 'M3.5 4.5h9M6.5 4.5v-1h3v1M5 4.5l.5 8h5l.5-8'

/**
 * A name field that commits on Enter or blur and cancels on Esc. `settled` stops the blur that
 * follows an Enter or Esc from committing a second time.
 */
function NameField({
  label,
  initial,
  onSubmit,
  onCancel,
}: {
  label: string
  initial: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  function commit() {
    if (settled.current) return
    settled.current = true
    onSubmit(input.current?.value ?? '')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      // The Escape belongs to this field: it must not reach a Peek or a menu behind it.
      event.preventDefault()
      event.stopPropagation()
      settled.current = true
      onCancel()
    }
  }

  return (
    <input
      ref={input}
      type="text"
      aria-label={label}
      defaultValue={initial}
      maxLength={80}
      onKeyDown={onKeyDown}
      onBlur={commit}
      className="h-7 min-w-0 flex-1 rounded-md border border-accent bg-panel px-2 text-ink"
    />
  )
}

/** Delete asks inline, in place of the row. Focus starts on Cancel, so Enter never deletes by accident. */
function ConfirmDelete({
  view,
  onConfirm,
  onCancel,
}: {
  view: SavedView
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancel.current?.focus()
  }, [])
  return (
    <div
      role="group"
      aria-label={`Delete view ${view.name}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
      className="space-y-1.5 rounded-md bg-hover px-2 py-1.5"
    >
      <p className="truncate" title={view.name}>
        Delete &ldquo;{view.name}&rdquo;?
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className="h-6 rounded border border-danger px-2 text-xs text-danger hover:bg-canvas"
        >
          Delete
        </button>
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          className="h-6 rounded border border-line px-2 text-xs hover:bg-canvas"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The saved views in the sidebar: apply, create from the current filters, rename and delete.
 * The list is `views.json`, the file `jm view list` reads. Arrow keys move between views.
 */
export function ViewsList({ filters, toggles, onApply }: ViewsListProps) {
  const viewsQuery = useViews()
  const create = useCreateView()
  const rename = useRenameView()
  const remove = useDeleteView()
  const views = viewsQuery.data
  const active = views === undefined ? undefined : activeView(views, filters, toggles)

  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  /** The name typed into the create field. A refusal remounts the field (new `attempt`) with it. */
  const [draft, setDraft] = useState({ name: '', attempt: 0 })
  /** The view whose apply button takes focus once the row is back, or `new` for the New view button. */
  const [refocus, setRefocus] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (refocus === null) return
    const target: HTMLElement | null | undefined =
      refocus === 'new'
        ? newButton.current
        : [...(list.current?.querySelectorAll<HTMLElement>('[data-view-apply]') ?? [])].find(
            (button) => button.dataset.viewApply === refocus,
          )
    // A view just created is not in the list until the cache says so; wait for the next render.
    if (target === null || target === undefined) return
    target.focus()
    setRefocus(null)
  }, [refocus, views])

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.dataset.viewApply === undefined) return
    if (event.key === 'F2') {
      event.preventDefault()
      startRename(target.dataset.viewApply)
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-view-apply]')]
    const next = buttons[buttons.indexOf(target) + step]
    if (next === undefined) return
    event.preventDefault()
    next.focus()
  }

  function startRename(id: string) {
    rename.reset()
    remove.reset()
    setCreating(false)
    setConfirmingId(null)
    setRenamingId(id)
  }

  function startCreate() {
    create.reset()
    rename.reset()
    remove.reset()
    setDraft((d) => ({ name: '', attempt: d.attempt + 1 }))
    setRenamingId(null)
    setConfirmingId(null)
    setCreating(true)
  }

  function startDelete(id: string) {
    rename.reset()
    remove.reset()
    setCreating(false)
    setRenamingId(null)
    setConfirmingId(id)
  }

  function submitCreate(name: string) {
    if (toggles === undefined || create.isPending) return
    if (name.trim() === '') {
      setCreating(false)
      setRefocus('new')
      return
    }
    create.mutate(
      { name, filters, toggles },
      {
        onSuccess(created) {
          setCreating(false)
          setRefocus(created.id)
        },
        onError() {
          // Keep the field open on what was typed, so a taken name can be fixed.
          setDraft((d) => ({ name, attempt: d.attempt + 1 }))
        },
      },
    )
  }

  function submitRename(view: SavedView, name: string) {
    setRenamingId(null)
    setRefocus(view.id)
    // A blank or unchanged name needs no write, and a blank one must never show as an empty row.
    if (name.trim() === '' || name.trim() === view.name) return
    rename.mutate({ id: view.id, name })
  }

  function confirmDelete(view: SavedView, index: number) {
    const neighbour = views?.[index + 1] ?? views?.[index - 1]
    setConfirmingId(null)
    setRefocus(neighbour?.id ?? 'new')
    remove.mutate({ id: view.id })
  }

  function cancelDelete(view: SavedView) {
    setConfirmingId(null)
    setRefocus(view.id)
  }

  return (
    <section aria-labelledby="views-heading" className="px-2">
      <div className="flex items-center justify-between px-2 pb-1 pt-3">
        <h2 id="views-heading" className="text-xs font-medium text-muted">
          Views
        </h2>
        <button
          ref={newButton}
          type="button"
          aria-label="New view"
          title="Save the current filters and toggles as a view"
          disabled={toggles === undefined}
          onClick={startCreate}
          className={`${ICON_BUTTON} disabled:opacity-50`}
        >
          <Icon path={PLUS} />
        </button>
      </div>

      {viewsQuery.isError && views === undefined && (
        <div role="alert" className="space-y-1 px-2 text-xs text-danger">
          <p>Could not load views. {viewsQuery.error.message}</p>
          <Details error={viewsQuery.error} />
          <button
            type="button"
            onClick={() => void viewsQuery.refetch()}
            className="rounded border border-line px-2 py-0.5 text-ink hover:bg-hover"
          >
            Retry
          </button>
        </div>
      )}
      {viewsQuery.isPending && <p className="px-2 text-xs text-muted">Loading views</p>}
      {views?.length === 0 && !creating && (
        <p className="px-2 text-xs text-muted">
          No saved views. Press + to save the current filters.
        </p>
      )}

      <ul ref={list} aria-label="Saved views" onKeyDown={onListKey} className="space-y-0.5">
        {views?.map((view, index) => (
          <li key={view.id} className="group/view">
            {confirmingId === view.id ? (
              <ConfirmDelete
                view={view}
                onConfirm={() => {
                  confirmDelete(view, index)
                }}
                onCancel={() => {
                  cancelDelete(view)
                }}
              />
            ) : renamingId === view.id ? (
              <div className="flex items-center">
                <NameField
                  label={`Rename view ${view.name}`}
                  initial={view.name}
                  onSubmit={(name) => {
                    submitRename(view, name)
                  }}
                  onCancel={() => {
                    setRenamingId(null)
                    setRefocus(view.id)
                  }}
                />
              </div>
            ) : (
              <div
                className={`flex items-center rounded-md pr-1 ${active?.id === view.id ? 'bg-selected' : 'hover:bg-hover'}`}
              >
                <button
                  type="button"
                  data-view-apply={view.id}
                  aria-current={active?.id === view.id ? 'true' : undefined}
                  onClick={() => {
                    onApply(view)
                  }}
                  className="h-7 min-w-0 flex-1 truncate rounded-md px-2 text-left"
                  title={view.name}
                >
                  {view.name}
                </button>
                <span className="flex opacity-0 group-focus-within/view:opacity-100 group-hover/view:opacity-100">
                  <button
                    type="button"
                    aria-label={`Rename view ${view.name}`}
                    onClick={() => {
                      startRename(view.id)
                    }}
                    className={ICON_BUTTON}
                  >
                    <Icon path={PENCIL} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete view ${view.name}`}
                    onClick={() => {
                      startDelete(view.id)
                    }}
                    className={ICON_BUTTON}
                  >
                    <Icon path={TRASH} />
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
        {creating && (
          <li className="flex items-center">
            <NameField
              key={draft.attempt}
              label="New view name"
              initial={draft.name}
              onSubmit={submitCreate}
              onCancel={() => {
                create.reset()
                setCreating(false)
                setRefocus('new')
              }}
            />
          </li>
        )}
      </ul>

      {create.isError && (
        <Failure
          lead="Could not save the view."
          error={create.error}
          className="px-2 pt-1 text-xs text-danger"
        />
      )}
      {rename.isError && (
        <Failure
          lead="Could not rename the view."
          error={rename.error}
          className="px-2 pt-1 text-xs text-danger"
        />
      )}
      {remove.isError && (
        <Failure
          lead="Could not delete the view."
          error={remove.error}
          className="px-2 pt-1 text-xs text-danger"
        />
      )}
    </section>
  )
}
