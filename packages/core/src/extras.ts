import { z } from 'zod'

import { adfDocSchema } from './adf-schema.js'
import { JiraMgrError } from './errors.js'
import { fetchAll } from './fields.js'
import type { HttpClient } from './http.js'
import { jiraTime } from './issue.js'
import { duration, issueKey, jiraId, parseInput, parseResponse } from './validate.js'

const person = z.object({ accountId: z.string(), displayName: z.string() })

// Comments

const commentSchema = z
  .object({
    id: z.string(),
    author: person.nullish(),
    body: adfDocSchema,
    created: jiraTime,
    updated: jiraTime,
  })
  .transform((c) => ({ ...c, author: c.author ?? null }))

export type IssueComment = z.infer<typeof commentSchema>

const commentsPage = z
  .object({ total: z.number(), comments: z.array(commentSchema) })
  .transform((page) => ({ total: page.total, items: page.comments }))

const commentPath = (key: string) => `/rest/api/3/issue/${key}/comment`

/** Every comment on the issue, oldest first. Bodies are ADF; `adfToMarkdown` renders one. */
export async function listComments(http: HttpClient, key: string): Promise<IssueComment[]> {
  const issue = parseInput(issueKey, key, 'list comments')
  return fetchAll(http, commentPath(issue), commentsPage)
}

/** Adds a comment from an ADF document (`markdownToAdf` converts Markdown). */
export async function addComment(
  http: HttpClient,
  key: string,
  body: z.input<typeof adfDocSchema>,
): Promise<IssueComment> {
  const input = parseInput(
    z.object({ key: issueKey, body: adfDocSchema }),
    { key, body },
    'add the comment',
  )
  const raw = await http.request('POST', commentPath(input.key), { body: { body: input.body } })
  return parseResponse(commentSchema, raw, 'comment')
}

/** Replaces a comment's body. Jira answers 403, mapped to `permission_denied`, for another user's comment. */
export async function editComment(
  http: HttpClient,
  key: string,
  commentId: string,
  body: z.input<typeof adfDocSchema>,
): Promise<IssueComment> {
  const input = parseInput(
    z.object({ key: issueKey, commentId: jiraId, body: adfDocSchema }),
    { key, commentId, body },
    'edit the comment',
  )
  const raw = await http.request('PUT', `${commentPath(input.key)}/${input.commentId}`, {
    body: { body: input.body },
  })
  return parseResponse(commentSchema, raw, 'comment')
}

/** Deletes a comment. Jira answers 403, mapped to `permission_denied`, for another user's comment. */
export async function deleteComment(
  http: HttpClient,
  key: string,
  commentId: string,
): Promise<void> {
  const input = parseInput(
    z.object({ key: issueKey, commentId: jiraId }),
    { key, commentId },
    'delete the comment',
  )
  await http.request('DELETE', `${commentPath(input.key)}/${input.commentId}`)
}

// Worklogs

const worklogSchema = z
  .object({
    id: z.string(),
    author: person.nullish(),
    timeSpent: z.string(),
    timeSpentSeconds: z.number(),
    started: jiraTime,
    comment: adfDocSchema.nullish(),
    created: jiraTime,
    updated: jiraTime,
  })
  .transform((w) => ({ ...w, author: w.author ?? null, comment: w.comment ?? null }))

export type Worklog = z.infer<typeof worklogSchema>

const worklogsPage = z
  .object({ total: z.number(), worklogs: z.array(worklogSchema) })
  .transform((page) => ({ total: page.total, items: page.worklogs }))

const worklogPath = (key: string) => `/rest/api/3/issue/${key}/worklog`
/** Reduces the remaining estimate by the time logged (Q11). */
const AUTO = '?adjustEstimate=auto'

const worklogFields = {
  /** A Jira duration such as `1h 30m`. */
  timeSpent: duration,
  /** Jira takes the instant; a Date is sent as UTC, `2026-10-07T01:02:03.000+0000`. */
  started: z.date({ error: 'started must be a valid Date.' }),
  comment: adfDocSchema,
}

/** Jira rejects the `Z` suffix, and wants `yyyy-MM-dd'T'HH:mm:ss.SSSZ`. */
const jiraStarted = (date: Date) => date.toISOString().replace(/Z$/, '+0000')

const addWorklogInput = z.strictObject({
  timeSpent: worklogFields.timeSpent,
  started: worklogFields.started.optional(),
  comment: worklogFields.comment.optional(),
})

export type AddWorklogInput = z.input<typeof addWorklogInput>

const editWorklogInput = addWorklogInput
  .partial()
  .refine((edit) => (Object.values(edit) as unknown[]).some((value) => value !== undefined), {
    error: 'Nothing to change.',
  })

export type EditWorklogInput = z.input<typeof editWorklogInput>

function worklogBody(input: z.output<typeof editWorklogInput>) {
  return {
    ...(input.timeSpent !== undefined && { timeSpent: input.timeSpent }),
    ...(input.started !== undefined && { started: jiraStarted(input.started) }),
    ...(input.comment !== undefined && { comment: input.comment }),
  }
}

/** Every worklog on the issue. */
export async function listWorklogs(http: HttpClient, key: string): Promise<Worklog[]> {
  const issue = parseInput(issueKey, key, 'list worklogs')
  return fetchAll(http, worklogPath(issue), worklogsPage)
}

/**
 * Logs work with `adjustEstimate=auto`, so the remaining estimate falls by `timeSpent`. Omit
 * `started` to start now.
 */
export async function addWorklog(
  http: HttpClient,
  key: string,
  input: AddWorklogInput,
  options: { signal?: AbortSignal } = {},
): Promise<Worklog> {
  const issue = parseInput(issueKey, key, 'log work')
  const body = parseInput(addWorklogInput, input, `log work on ${issue}`)
  const raw = await http.request('POST', `${worklogPath(issue)}${AUTO}`, {
    body: worklogBody(body),
    ...(options.signal !== undefined && { signal: options.signal }),
  })
  return parseResponse(worklogSchema, raw, 'worklog')
}

/** Changes a worklog. Jira moves the remaining estimate by the difference (`adjustEstimate=auto`). */
export async function editWorklog(
  http: HttpClient,
  key: string,
  worklogId: string,
  input: EditWorklogInput,
): Promise<Worklog> {
  const ids = parseInput(
    z.object({ key: issueKey, worklogId: jiraId }),
    { key, worklogId },
    'edit the worklog',
  )
  const body = parseInput(editWorklogInput, input, `edit worklog ${ids.worklogId}`)
  const raw = await http.request('PUT', `${worklogPath(ids.key)}/${ids.worklogId}${AUTO}`, {
    body: worklogBody(body),
  })
  return parseResponse(worklogSchema, raw, 'worklog')
}

/** Deletes a worklog and gives its time back to the remaining estimate. */
export async function deleteWorklog(
  http: HttpClient,
  key: string,
  worklogId: string,
): Promise<void> {
  const ids = parseInput(
    z.object({ key: issueKey, worklogId: jiraId }),
    { key, worklogId },
    'delete the worklog',
  )
  await http.request('DELETE', `${worklogPath(ids.key)}/${ids.worklogId}${AUTO}`)
}

// Links

const linkType = z.object({
  id: z.string(),
  name: z.string(),
  inward: z.string(),
  outward: z.string(),
})

export type LinkType = z.infer<typeof linkType>

const linkedIssue = z.object({
  key: z.string(),
  fields: z.object({ summary: z.string(), status: z.object({ name: z.string() }) }),
})

const linkSchema = z
  .object({
    id: z.string(),
    type: linkType,
    inwardIssue: linkedIssue.optional(),
    outwardIssue: linkedIssue.optional(),
  })
  .transform((link, ctx) => {
    const other = link.outwardIssue ?? link.inwardIssue
    if (other === undefined || (link.outwardIssue && link.inwardIssue)) {
      ctx.addIssue({ code: 'custom', message: 'A link holds one linked issue.' })
      return z.NEVER
    }
    const direction = link.outwardIssue ? ('outward' as const) : ('inward' as const)
    return {
      id: link.id,
      type: link.type,
      /** `outward` reads "<this issue> <type.outward> <issue>", `inward` "<this issue> <type.inward> <issue>". */
      direction,
      issue: { key: other.key, summary: other.fields.summary, status: other.fields.status.name },
    }
  })

export type IssueLink = z.infer<typeof linkSchema>

/** The links of one issue, each seen from that issue. */
export async function listLinks(http: HttpClient, key: string): Promise<IssueLink[]> {
  const issue = parseInput(issueKey, key, 'list links')
  const raw = await http.request('GET', `/rest/api/3/issue/${issue}?fields=issuelinks`)
  return parseResponse(
    z.object({ fields: z.object({ issuelinks: z.array(linkSchema) }) }),
    raw,
    'links',
  ).fields.issuelinks
}

/** All link types the site has, owned by Jira or by other tools, unfiltered. */
export async function listLinkTypes(http: HttpClient): Promise<LinkType[]> {
  const raw = await http.request('GET', '/rest/api/3/issueLinkType')
  return parseResponse(z.object({ issueLinkTypes: z.array(linkType) }), raw, 'link types')
    .issueLinkTypes
}

const addLinkInput = z.strictObject({
  /** A link type's name (`Blocks`) or id, from `listLinkTypes`. */
  type: z.union([z.strictObject({ name: z.string().min(1) }), z.strictObject({ id: jiraId })]),
  /** The issue the link is added from. */
  key: issueKey,
  /** `outward` says "key blocks otherKey", `inward` says "key is blocked by otherKey". */
  direction: z.enum(['outward', 'inward']),
  otherKey: issueKey,
})

export type AddLinkInput = z.input<typeof addLinkInput>

/**
 * Links two issues. `direction: 'outward'` with type `Blocks` makes `key` block `otherKey`;
 * `'inward'` makes `key` blocked by `otherKey`. Jira's POST names the blocking side
 * `inwardIssue`, verified against live PSAPAC on 2026-10-07 (link 642179, created and deleted).
 * Jira answers 201 with no body, so the new link's id comes from `listLinks`.
 */
export async function addLink(http: HttpClient, input: AddLinkInput): Promise<void> {
  const link = parseInput(addLinkInput, input, 'add the link')
  const [source, target] =
    link.direction === 'outward' ? [link.key, link.otherKey] : [link.otherKey, link.key]
  await http.request('POST', '/rest/api/3/issueLink', {
    body: { type: link.type, inwardIssue: { key: source }, outwardIssue: { key: target } },
  })
}

const linkEnd = z.object({ key: z.string() })

/** One link read by its id: its type and the keys of the two issues it joins. */
export async function getLink(
  http: HttpClient,
  linkId: string,
): Promise<{ id: string; type: LinkType; inwardKey: string; outwardKey: string }> {
  const id = parseInput(jiraId, linkId, 'read the link')
  const raw = await http.request('GET', `/rest/api/3/issueLink/${id}`)
  const link = parseResponse(
    z.object({ id: z.string(), type: linkType, inwardIssue: linkEnd, outwardIssue: linkEnd }),
    raw,
    'link',
  )
  return {
    id: link.id,
    type: link.type,
    inwardKey: link.inwardIssue.key,
    outwardKey: link.outwardIssue.key,
  }
}

/** Removes a link by its id, as `listLinks` reports it. */
export async function removeLink(http: HttpClient, linkId: string): Promise<void> {
  const id = parseInput(jiraId, linkId, 'remove the link')
  await http.request('DELETE', `/rest/api/3/issueLink/${id}`)
}

// Attachments

const attachmentSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    size: z.number(),
    mimeType: z.string().nullish(),
    created: jiraTime,
    author: person.nullish(),
    content: z.string(),
  })
  .transform(({ content, ...a }) => ({
    ...a,
    mimeType: a.mimeType ?? null,
    author: a.author ?? null,
    contentUrl: content,
  }))

export type Attachment = z.infer<typeof attachmentSchema>

const attachmentMeta = z.object({ enabled: z.boolean(), uploadLimit: z.number() })

/** The attachments of one issue. */
export async function listAttachments(http: HttpClient, key: string): Promise<Attachment[]> {
  const issue = parseInput(issueKey, key, 'list attachments')
  const raw = await http.request('GET', `/rest/api/3/issue/${issue}?fields=attachment`)
  return parseResponse(
    z.object({ fields: z.object({ attachment: z.array(attachmentSchema) }) }),
    raw,
    'attachments',
  ).fields.attachment
}

const addAttachmentInput = z.strictObject({
  key: issueKey,
  files: z
    .array(
      z.strictObject({
        filename: z.string().min(1).max(255),
        content: z.union([z.instanceof(Blob), z.instanceof(Uint8Array)]),
      }),
    )
    .min(1),
})

/** An upload gets this long, plus `UPLOAD_MS_PER_MB` for each megabyte, since a large file outlasts a read's timeout. */
const UPLOAD_BASE_MS = 30_000
const UPLOAD_MS_PER_MB = 10_000

/**
 * Uploads files as multipart, one request each, in order. It reads the site's `uploadLimit` once
 * (100 MB on PSAPAC) and refuses the whole batch, before any bytes are sent, when attachments are
 * off or any file is over it. A failure after the first upload names the files already attached,
 * in the message and in `details.attached`.
 */
export async function addAttachments(
  http: HttpClient,
  key: string,
  files: { filename: string; content: Blob | Uint8Array }[],
): Promise<Attachment[]> {
  const input = parseInput(addAttachmentInput, { key, files }, 'attach the files')
  const blobs = input.files.map(({ filename, content }) => ({
    filename,
    blob: content instanceof Blob ? content : new Blob([new Uint8Array(content)]),
  }))
  const meta = parseResponse(
    attachmentMeta,
    await http.request('GET', '/rest/api/3/attachment/meta'),
    'attachment settings',
  )
  if (!meta.enabled) {
    throw new JiraMgrError('validation_failed', 'Attachments are turned off on this Jira site.')
  }
  for (const { filename, blob } of blobs) {
    if (blob.size > meta.uploadLimit) {
      throw new JiraMgrError(
        'validation_failed',
        `${filename} is ${String(blob.size)} bytes, over this site's limit of ${String(meta.uploadLimit)}. Attach a smaller file.`,
        { details: { size: blob.size, uploadLimit: meta.uploadLimit } },
      )
    }
  }
  const attached: Attachment[] = []
  for (const { filename, blob } of blobs) {
    const form = new FormData()
    form.append('file', blob, filename)
    try {
      const raw = await http.request('POST', `/rest/api/3/issue/${input.key}/attachments`, {
        body: form,
        timeoutMs: UPLOAD_BASE_MS + Math.ceil(blob.size / 1_000_000) * UPLOAD_MS_PER_MB,
      })
      attached.push(...parseResponse(z.array(attachmentSchema), raw, 'attachment upload'))
    } catch (error) {
      if (!(error instanceof JiraMgrError) || attached.length === 0) throw error
      const names = attached.map((a) => a.filename).join(', ')
      throw new JiraMgrError(error.code, `${error.message} Already attached: ${names}.`, {
        details: { error: error.details, attached },
        cause: error,
      })
    }
  }
  return attached
}

/** Uploads one file as multipart. See `addAttachments`. */
export const addAttachment = (
  http: HttpClient,
  key: string,
  file: { filename: string; content: Blob | Uint8Array },
): Promise<Attachment[]> => addAttachments(http, key, [file])

/** Removes an attachment by its id. */
export async function removeAttachment(http: HttpClient, attachmentId: string): Promise<void> {
  const id = parseInput(jiraId, attachmentId, 'remove the attachment')
  await http.request('DELETE', `/rest/api/3/attachment/${id}`)
}
