import type { ViewFilters } from '@jira-mgr/core/view-filter'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { SavedView, Toggles } from '../../shared/ipc'
import { Details, Failure } from './Failure'
import { CHECK, COPY, Icon, PENCIL, PLUS, TRASH } from './Icon'
import {
  useCreateView,
  useDeleteView,
  useDuplicateView,
  useMoveView,
  useRenameView,
  useUpdateView,
  useViews,
} from './viewQueries'
import { activeView, viewMatches } from './views'

interface ViewsListProps {
  /** The filter bar and toggles as they are now: what "New view" saves, and what marks a view active. */
  filters: ViewFilters
  toggles: Toggles | undefined
  /** The view applied last: of twin views, the one that is lit. */
  applied: string | undefined
  onApply: (view: SavedView) => void
  /** False while a sprint page holds the sidebar's one highlight. */
  showCurrent?: boolean
}

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
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onConfirm} className="btn btn-sm btn-danger">
          Delete
        </button>
        <button ref={cancel} type="button" onClick={onCancel} className="btn btn-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}

/** A line on the edge of the row a drop would land beside: below when the view moves down, above when it moves up. */
function dropEdge(
  views: SavedView[] | undefined,
  drag: { id: string; over: number | null } | null,
  index: number,
) {
  if (drag?.over !== index) return ''
  const from = views?.findIndex((v) => v.id === drag.id) ?? -1
  if (from === index) return ''
  return from < index
    ? 'shadow-[inset_0_-2px_0_var(--accent)]'
    : 'shadow-[inset_0_2px_0_var(--accent)]'
}

/**
 * The saved views in the sidebar: apply, create from the current filters, update with them,
 * duplicate, rename, delete and reorder. The list is `views.json`, the file `jm view list` reads.
 * Arrow keys move between views, and Alt with an arrow moves the focused view. A drag does the same.
 */
export function ViewsList({ filters, toggles, applied, onApply, showCurrent = true }: ViewsListProps) {
  const viewsQuery = useViews()
  const create = useCreateView()
  const rename = useRenameView()
  const remove = useDeleteView()
  const update = useUpdateView()
  const duplicate = useDuplicateView()
  const move = useMoveView()
  const views = viewsQuery.data
  const active =
    views === undefined || !showCurrent
      ? undefined
      : activeView(views, filters, toggles, applied)

  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  /** The name typed into the create field. A refusal remounts the field (new `attempt`) with it. */
  const [draft, setDraft] = useState({ name: '', attempt: 0 })
  /** The view whose apply button takes focus once the row is back, or `new` for the New view button. */
  const [refocus, setRefocus] = useState<string | null>(null)
  /** The view being dragged, and the row it hovers over (the drop position). */
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  /** The view a key press moved: reordering rows can drop focus, so it goes back once the list changes. */
  const keepFocus = useRef<string | null>(null)

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

  useEffect(() => {
    const id = keepFocus.current
    if (id === null) return
    keepFocus.current = null
    const button = [
      ...(list.current?.querySelectorAll<HTMLElement>('[data-view-apply]') ?? []),
    ].find((b) => b.dataset.viewApply === id)
    if (button !== undefined && document.activeElement !== button) button.focus()
  }, [views])

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
    if (event.altKey) {
      event.preventDefault()
      const from = views?.findIndex((v) => v.id === target.dataset.viewApply) ?? -1
      if (from >= 0 && views?.[from + step] !== undefined) {
        keepFocus.current = target.dataset.viewApply
        move.mutate({ id: target.dataset.viewApply, toIndex: from + step })
      }
      return
    }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-view-apply]')]
    const next = buttons[buttons.indexOf(target) + step]
    if (next === undefined) return
    event.preventDefault()
    next.focus()
  }

  function resetFailures() {
    rename.reset()
    remove.reset()
    update.reset()
    duplicate.reset()
    move.reset()
  }

  function startRename(id: string) {
    resetFailures()
    setCreating(false)
    setConfirmingId(null)
    setRenamingId(id)
  }

  function startCreate() {
    create.reset()
    resetFailures()
    setDraft((d) => ({ name: '', attempt: d.attempt + 1 }))
    setRenamingId(null)
    setConfirmingId(null)
    setCreating(true)
  }

  function startDelete(id: string) {
    resetFailures()
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

  function updateFromBar(view: SavedView) {
    if (toggles === undefined) return
    resetFailures()
    update.mutate({ id: view.id, filters, toggles })
  }

  function duplicateView(view: SavedView) {
    resetFailures()
    duplicate.mutate(
      { id: view.id },
      {
        onSuccess(copy) {
          setRefocus(copy.id)
        },
      },
    )
  }

  function drop(toIndex: number) {
    const id = drag?.id
    setDrag(null)
    if (id === undefined || views?.findIndex((v) => v.id === id) === toIndex) return
    resetFailures()
    move.mutate({ id, toIndex })
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
          className="btn btn-sm btn-icon btn-ghost"
        >
          <Icon path={PLUS} />
        </button>
      </div>

      {viewsQuery.isError && views === undefined && (
        <div role="alert" className="space-y-1 px-2 text-xs text-danger">
          <p>Could not load views. {viewsQuery.error.message}</p>
          <Details error={viewsQuery.error} />
          <button type="button" onClick={() => void viewsQuery.refetch()} className="btn btn-sm">
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
          <li
            key={view.id}
            className="group/view"
            draggable={confirmingId !== view.id && renamingId !== view.id}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', view.id)
              setDrag({ id: view.id, over: null })
            }}
            onDragOver={(event) => {
              if (drag === null) return
              event.preventDefault()
              if (drag.over !== index) setDrag({ ...drag, over: index })
            }}
            onDrop={(event) => {
              event.preventDefault()
              drop(index)
            }}
            onDragEnd={() => {
              setDrag(null)
            }}
          >
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
                className={`relative flex items-center rounded-md pr-1 ${active?.id === view.id ? 'is-current' : 'hover:bg-hover focus-within:bg-hover'} ${dropEdge(views, drag, index)}`}
              >
                <button
                  type="button"
                  data-row
                  data-view-apply={view.id}
                  aria-current={active?.id === view.id ? 'true' : undefined}
                  onClick={() => {
                    onApply(view)
                  }}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  className="h-7 min-w-0 flex-1 truncate rounded-md px-2 text-left"
                  title={view.name}
                >
                  {view.name}
                </button>
                <span className="absolute inset-y-0 right-1 flex items-center rounded-md bg-inherit opacity-0 group-focus-within/view:opacity-100 group-hover/view:opacity-100">
                  <button
                    type="button"
                    aria-label={`Update view ${view.name}`}
                    title="Replace this view's filters and toggles with the current ones"
                    disabled={
                      toggles === undefined ||
                      update.isPending ||
                      viewMatches(view, filters, toggles)
                    }
                    onClick={() => {
                      updateFromBar(view)
                    }}
                    className="btn btn-sm btn-icon btn-ghost"
                  >
                    <Icon path={CHECK} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate view ${view.name}`}
                    disabled={duplicate.isPending}
                    onClick={() => {
                      duplicateView(view)
                    }}
                    className="btn btn-sm btn-icon btn-ghost"
                  >
                    <Icon path={COPY} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename view ${view.name}`}
                    onClick={() => {
                      startRename(view.id)
                    }}
                    className="btn btn-sm btn-icon btn-ghost"
                  >
                    <Icon path={PENCIL} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete view ${view.name}`}
                    onClick={() => {
                      startDelete(view.id)
                    }}
                    className="btn btn-sm btn-icon btn-ghost btn-delete"
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
      {update.isError && (
        <Failure
          lead="Could not update the view."
          error={update.error}
          className="px-2 pt-1 text-xs text-danger"
        />
      )}
      {duplicate.isError && (
        <Failure
          lead="Could not duplicate the view."
          error={duplicate.error}
          className="px-2 pt-1 text-xs text-danger"
        />
      )}
      {move.isError && (
        <Failure
          lead="Could not reorder the views."
          error={move.error}
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
