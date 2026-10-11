import type { Issue } from '@jira-mgr/core'
import { useId, useState, type SyntheticEvent, type KeyboardEvent } from 'react'

import type { LinkItem, LinkTypeItem } from '../../shared/ipc'
import {
  failureNotice,
  findChoice,
  groupLinks,
  linkChoices,
  looksLikeKey,
  type LinkChoice,
} from './activity'
import { useAddLink, useLinks, useRemoveLink } from './activityQueries'
import type { Notice } from './create'
import { Icon, TRASH } from './Icon'
import { AddAction, FIELD, QueryBody, Section } from './Section'

interface LinksSectionProps {
  issueKey: string
  /** Every loaded issue: the key field suggests them, and a linked one among them opens its page. */
  issues: readonly Issue[]
  onOpen: (key: string) => void
  onNotice: (notice: Notice) => void
}

const optionOf = (choice: LinkChoice) => (
  <option key={choice.value} value={choice.value}>
    {choice.label}
  </option>
)

interface AddLinkFormProps {
  issueKey: string
  types: readonly LinkTypeItem[]
  issues: readonly Issue[]
  onDone: () => void
}

/** One select for the type read in one direction, a key and Add. Q19 orders the select. */
function AddLinkForm({ issueKey, types, issues, onDone }: AddLinkFormProps) {
  const add = useAddLink(issueKey)
  const list = useId()
  const { common, other } = linkChoices(types)
  const [value, setValue] = useState(common[0]?.value ?? other[0]?.value ?? '')
  const [otherKey, setOtherKey] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const key = otherKey.trim().toUpperCase()
  const valid = looksLikeKey(key) && key !== issueKey && findChoice(types, value) !== undefined

  async function submit(event: SyntheticEvent) {
    event.preventDefault()
    const choice = findChoice(types, value)
    if (!valid || choice === undefined) return
    setProblem(null)
    try {
      await add.mutateAsync({ typeId: choice.typeId, direction: choice.direction, otherKey: key })
      onDone()
    } catch (error) {
      setProblem(`Could not add the link. ${error instanceof Error ? error.message : ''}`)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onDone()
  }

  return (
    <form
      aria-label="Add link"
      onSubmit={(event) => void submit(event)}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-end gap-3 rounded-md border border-line p-3"
    >
      <label className="space-y-0.5">
        <span className="block text-xs text-muted">Link type</span>
        <select
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
          className={FIELD}
        >
          <optgroup label="Common">{common.map(optionOf)}</optgroup>
          {other.length > 0 && <optgroup label="Other">{other.map(optionOf)}</optgroup>}
        </select>
      </label>
      <label className="space-y-0.5">
        <span className="block text-xs text-muted">Linked issue</span>
        <input
          autoFocus
          list={list}
          value={otherKey}
          placeholder="PSAPAC-12"
          disabled={add.isPending}
          onChange={(event) => {
            setOtherKey(event.target.value)
          }}
          className={`${FIELD} w-36 font-mono`}
        />
        <datalist id={list}>
          {issues
            .filter((issue) => issue.key !== issueKey)
            .map((issue) => (
              <option key={issue.key} value={issue.key}>
                {issue.summary}
              </option>
            ))}
        </datalist>
      </label>
      <button type="submit" disabled={!valid || add.isPending} className="btn btn-primary">
        {add.isPending ? 'Adding' : 'Add link'}
      </button>
      <button type="button" onClick={onDone} className="btn">
        Cancel
      </button>
      {problem !== null && (
        <p role="alert" className="w-full text-danger">
          {problem}
        </p>
      )}
    </form>
  )
}

interface LinkRowProps extends Pick<LinksSectionProps, 'issueKey' | 'onOpen' | 'onNotice'> {
  link: LinkItem
  /** True when the linked issue is in the loaded list, so its page can open. */
  known: boolean
}

function LinkRow({ issueKey, link, known, onOpen, onNotice }: LinkRowProps) {
  const remove = useRemoveLink(issueKey)
  return (
    <li className="group/row flex h-8 items-center gap-3 px-3">
      {known ? (
        <button
          type="button"
          onClick={() => {
            onOpen(link.issue.key)
          }}
          data-row
          className="w-20 shrink-0 text-left font-mono text-xs text-muted hover:text-ink"
        >
          {link.issue.key}
        </button>
      ) : (
        <span className="w-20 shrink-0 font-mono text-xs text-muted">{link.issue.key}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{link.issue.summary}</span>
      <span className="shrink-0 text-xs text-muted">{link.issue.status}</span>
      <button
        type="button"
        aria-label={`Remove link to ${link.issue.key}`}
        onClick={() => {
          remove
            .mutateAsync({ linkId: link.id, otherKey: link.issue.key })
            .catch((error: unknown) => {
              onNotice(
                failureNotice(
                  'Could not remove the link',
                  error instanceof Error ? error.message : String(error),
                ),
              )
            })
        }}
        className="btn btn-sm btn-icon btn-ghost btn-delete opacity-0 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
      >
        <Icon path={TRASH} />
      </button>
    </li>
  )
}

/** The Links section: each link under the phrase it reads as, and a form that adds one. */
export function LinksSection({ issueKey, issues, onOpen, onNotice }: LinksSectionProps) {
  const links = useLinks(issueKey)
  const [adding, setAdding] = useState(false)
  const loaded = new Set(issues.map((issue) => issue.key))
  return (
    <Section
      title="Links"
      actions={
        !adding &&
        links.data !== undefined && (
          <AddAction
            label="Add link"
            onClick={() => {
              setAdding(true)
            }}
          />
        )
      }
    >
      <QueryBody query={links} loading="Loading links" what="the links">
        {({ links: list, types }) => (
          <>
            {adding && (
              <AddLinkForm
                issueKey={issueKey}
                types={types}
                issues={issues}
                onDone={() => {
                  setAdding(false)
                }}
              />
            )}
            {list.length === 0 && !adding && <p className="text-muted">No links</p>}
            {groupLinks(list).map(({ phrase, links: grouped }) => (
              <div key={phrase} className="space-y-0.5">
                <h3 className="text-xs text-muted">{phrase}</h3>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {grouped.map((link) => (
                    <LinkRow
                      key={link.id}
                      issueKey={issueKey}
                      link={link}
                      known={loaded.has(link.issue.key)}
                      onOpen={onOpen}
                      onNotice={onNotice}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </QueryBody>
    </Section>
  )
}
