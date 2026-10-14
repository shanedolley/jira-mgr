import { adfToMarkdown, type AdfDoc, type AdfNode } from '@jira-mgr/core/adf'
import { parseDuration } from '@jira-mgr/core/issue'

import type { LinkItem, LinkTypeItem, WorklogItem } from '../../shared/ipc'
import type { Notice } from './create'

/** The link types Q19 puts above the divider, in this order. Every other type follows, in Jira's order. */
const COMMON_LINK_TYPES = ['Blocks', 'Relates', 'Duplicate', 'Causes', 'Cloners']

/** One entry of the link picker: a type read in one direction. */
export interface LinkChoice {
  /** `<type id>:<direction>`, the value of the option. */
  value: string
  typeId: string
  direction: 'outward' | 'inward'
  /** What "this issue ... other" reads as: "blocks", "is blocked by". */
  label: string
}

/**
 * The picker's choices, Q19's five types first and the rest below. A type whose two phrases are
 * the same (Relates) gives one choice, since the direction would make no difference.
 */
export function linkChoices(types: readonly LinkTypeItem[]): {
  common: LinkChoice[]
  other: LinkChoice[]
} {
  const choicesOf = (type: LinkTypeItem): LinkChoice[] => {
    const outward: LinkChoice = {
      value: `${type.id}:outward`,
      typeId: type.id,
      direction: 'outward',
      label: type.outward,
    }
    if (type.inward === type.outward) return [outward]
    return [
      outward,
      { value: `${type.id}:inward`, typeId: type.id, direction: 'inward', label: type.inward },
    ]
  }
  const rank = (type: LinkTypeItem) => COMMON_LINK_TYPES.indexOf(type.name)
  const common = types
    .filter((type) => rank(type) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .flatMap(choicesOf)
  const other = types.filter((type) => rank(type) < 0).flatMap(choicesOf)
  return { common, other }
}

/** The choice an option's value names, or `undefined` for a value that matches none. */
export function findChoice(types: readonly LinkTypeItem[], value: string): LinkChoice | undefined {
  const { common, other } = linkChoices(types)
  return [...common, ...other].find((choice) => choice.value === value)
}

/** How a link reads from the issue it was listed for: "blocks", "is blocked by". */
export const linkPhrase = (link: Pick<LinkItem, 'type' | 'direction'>): string =>
  link.direction === 'outward' ? link.type.outward : link.type.inward

/** The links grouped under their phrase, in the order each phrase first appears. */
export function groupLinks(links: readonly LinkItem[]): { phrase: string; links: LinkItem[] }[] {
  const groups = new Map<string, LinkItem[]>()
  for (const link of links) {
    const phrase = linkPhrase(link)
    groups.set(phrase, [...(groups.get(phrase) ?? []), link])
  }
  return [...groups].map(([phrase, grouped]) => ({ phrase, links: grouped }))
}

/** True for text shaped like an issue key. Main and Jira decide whether the issue is allowed. */
export const looksLikeKey = (text: string): boolean => /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(text)

/** A document of one paragraph per line, or `null` for text with no words. */
export function adfFromText(text: string): AdfDoc | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return null
  return {
    version: 1,
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  }
}

function textOf(node: AdfNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const inner = (node.content ?? []).map(textOf)
  // A block ends its line; an inline node runs on.
  return ['paragraph', 'heading', 'codeBlock', 'listItem'].includes(node.type)
    ? `${inner.join('')}\n`
    : inner.join('')
}

/** A document's words as plain text, one line for each block. */
export const textFromAdf = (doc: AdfDoc | null): string =>
  doc === null ? '' : doc.content.map(textOf).join('').trimEnd()

/** The worklog form's fields as typed. */
export interface WorklogForm {
  /** A duration as typed, such as `1h15m` or `1.25 hours`. */
  timeSpent: string
  /**
   * A `datetime-local` value, `2026-10-10T14:30`, in local time. A new worklog holds a date,
   * `2026-10-10`, and starts at that day's current time of day.
   */
  started: string
  comment: string
}

export type WorklogRequest =
  | { ok: true; timeSpent: string; started: string | undefined; comment: AdfDoc | undefined }
  | { ok: false; message: string; field: keyof WorklogForm }

/** `datetime-local` text for an instant, in local time. */
export function toInputTime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** What the form holds for a new worklog: today, nothing logged and no comment. */
export const blankWorklog = (now: Date = new Date()): WorklogForm => ({
  timeSpent: '',
  started: toInputTime(now.toISOString()).slice(0, 10),
  comment: '',
})

/** What the form holds for an existing worklog. */
export const worklogForm = (worklog: WorklogItem): WorklogForm => ({
  timeSpent: worklog.timeSpent,
  started: toInputTime(worklog.started),
  comment: textFromAdf(worklog.comment),
})

/**
 * Reads the form into a request, or says what is wrong and in which field. Time spent is sent in
 * Jira's format, so "1.25 hours" goes as "1h 15m". A date with no time starts at `now`'s time of
 * day. An edit drops a comment the user emptied, because Jira's worklog write cannot clear one
 * here (`hadComment`).
 */
export function readWorklogForm(
  form: WorklogForm,
  hadComment = false,
  now: Date = new Date(),
): WorklogRequest {
  const timeSpent = parseDuration(form.timeSpent)
  if (timeSpent === null) {
    return {
      ok: false,
      field: 'timeSpent',
      message: 'Time spent must be a duration such as 1h 30m, 1.5 hours or 90m.',
    }
  }
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(form.started)
  const started = new Date(
    dated ? `${form.started}T${toInputTime(now.toISOString()).slice(11)}` : form.started,
  )
  if (form.started === '' || Number.isNaN(started.getTime())) {
    return {
      ok: false,
      field: 'started',
      message: 'Started must be a valid date.',
    }
  }
  const comment = adfFromText(form.comment)
  if (comment === null && hadComment) {
    return {
      ok: false,
      field: 'comment',
      message: 'A worklog comment cannot be removed here. Edit it in Jira.',
    }
  }
  return {
    ok: true,
    timeSpent,
    started: started.toISOString(),
    comment: comment ?? undefined,
  }
}

/** The worklogs' total time as hours and minutes. */
export const totalSpent = (worklogs: readonly WorklogItem[]): number =>
  worklogs.reduce((sum, worklog) => sum + worklog.timeSpentSeconds, 0)

/** A byte count as people read it: "96.4 KB", "5.0 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** A date and time as the user's locale writes them. */
export const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** The notice for a write Jira refused: what failed, then Jira's reason. It stays until dismissed. */
export const failureNotice = (title: string, reason: string): Notice => ({
  title,
  notes: [reason],
  warned: true,
})

/** A document as Markdown text, for one the editor could not take. */
export function safeMarkdown(doc: AdfDoc): string {
  try {
    return adfToMarkdown(doc)
  } catch {
    return ''
  }
}
