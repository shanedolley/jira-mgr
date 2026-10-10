import { JiraMgrError, type Issue } from '@jira-mgr/core'
import type { IssueDetail } from '@jira-mgr/core/issue'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { CommentItem, LinksResult } from '../../shared/ipc'
import { commentsQuery, editCommentMutation, readIssue, removeMutation } from './activityQueries'
import { clearDrafts, commentDraftKey, getDraft, newCommentDraftKey, putDraft } from './drafts'
import { issueDetailKey, summaryMutation } from './optimistic'
import { activityKey, clearAccountData, commentsKey, linksKey } from './queries'

const calls = vi.hoisted(() => vi.fn<(channel: string) => Promise<unknown>>())
vi.mock('./ipc', () => ({ call: calls }))

interface Row {
  id: string
}

const rows: Row[] = [{ id: '1' }, { id: '2' }, { id: '3' }]
const without = (list: Row[], id: string) => list.filter((row) => row.id !== id)

describe('removeMutation', () => {
  it('removes the row at once, before Jira answers', async () => {
    const client = new QueryClient()
    const key = commentsKey('PSAPAC-1')
    client.setQueryData(key, rows)
    let answer!: () => void
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    const pending = new MutationObserver(
      client,
      removeMutation<Row[], string>(client, key, () => held, without),
    ).mutate('2')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.getQueryData<Row[]>(key)).toEqual([{ id: '1' }, { id: '3' }])
    answer()
    await pending
  })

  it('puts the data back when Jira refuses', async () => {
    const client = new QueryClient()
    const key = commentsKey('PSAPAC-1')
    client.setQueryData(key, rows)
    const refused = new MutationObserver(
      client,
      removeMutation<Row[], string>(
        client,
        key,
        () => Promise.reject(new JiraMgrError('permission_denied', 'Not yours.')),
        without,
      ),
    ).mutate('2')
    await expect(refused).rejects.toMatchObject({ code: 'permission_denied' })
    expect(client.getQueryData<Row[]>(key)).toEqual(rows)
  })

  it('runs its follow-up with the arguments once the write settles, refused or not', async () => {
    const client = new QueryClient()
    const key = linksKey('PSAPAC-1')
    const data: LinksResult = { links: [], types: [] }
    client.setQueryData(key, data)
    const seen: string[] = []
    const options = removeMutation<LinksResult, string>(
      client,
      key,
      () => Promise.reject(new JiraMgrError('jira_error', 'Down.')),
      (held) => held,
      (other) => seen.push(other),
    )
    await new MutationObserver(client, options).mutate('PSAPAC-2').catch(() => undefined)
    expect(seen).toEqual(['PSAPAC-2'])
  })
})

describe('clearAccountData', () => {
  it("logout removes every issue's comments, worklogs, links and attachment lists", () => {
    const client = new QueryClient()
    client.setQueryData(commentsKey('PSAPAC-1'), rows)
    client.setQueryData(linksKey('PSAPAC-2'), { links: [], types: [] })
    clearAccountData(client)
    expect(client.getQueryCache().findAll({ queryKey: activityKey })).toEqual([])
  })
})

const text = (words: string) => ({
  version: 1 as const,
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }],
})
const comment = (id: string, words: string) => ({ id, body: text(words) }) as CommentItem
const draft = (base: ReturnType<typeof text>) => ({ doc: text('mine'), base })

/** Answers the next comment list read with `list`, and an edit with the comment it changed. */
function jiraHolds(list: CommentItem[]) {
  calls.mockReset()
  calls.mockImplementation((channel) =>
    Promise.resolve(channel === 'comments:list' ? list : comment('7', 'mine')),
  )
}

describe('comment drafts and the comment list', () => {
  it('drops the draft of a comment the list read no longer holds', async () => {
    clearDrafts()
    putDraft(commentDraftKey('PSAPAC-1', '7'), draft(text('old')))
    putDraft(commentDraftKey('PSAPAC-1', '8'), draft(text('old')))
    putDraft(newCommentDraftKey('PSAPAC-1'), draft(text('old')))
    putDraft('PSAPAC-1', draft(text('old')))
    putDraft(commentDraftKey('PSAPAC-2', '7'), draft(text('old')))
    jiraHolds([comment('8', 'old')])

    await new QueryClient().query(commentsQuery('PSAPAC-1'))

    expect(getDraft(commentDraftKey('PSAPAC-1', '7'))).toBeUndefined()
    // The comments the read holds, the new-comment box, the description and other issues stay.
    expect(getDraft(commentDraftKey('PSAPAC-1', '8'))).toBeDefined()
    expect(getDraft(newCommentDraftKey('PSAPAC-1'))).toBeDefined()
    expect(getDraft('PSAPAC-1')).toBeDefined()
    expect(getDraft(commentDraftKey('PSAPAC-2', '7'))).toBeDefined()
    clearDrafts()
  })
})

describe('comment drafts made while a list read runs', () => {
  it('keeps the draft of a comment added after the read began', async () => {
    clearDrafts()
    putDraft(commentDraftKey('PSAPAC-1', '7'), draft(text('old')))
    // The read answers without comment 9, which the user adds and starts editing meanwhile.
    calls.mockReset()
    calls.mockImplementation(() => {
      putDraft(commentDraftKey('PSAPAC-1', '9'), draft(text('old')))
      return Promise.resolve([comment('8', 'old')])
    })

    await new QueryClient().query(commentsQuery('PSAPAC-1'))

    expect(getDraft(commentDraftKey('PSAPAC-1', '7'))).toBeUndefined()
    expect(getDraft(commentDraftKey('PSAPAC-1', '9'))).toBeDefined()
    clearDrafts()
  })
})

describe('editCommentMutation', () => {
  const edit = (client: QueryClient, base: ReturnType<typeof text>) =>
    new MutationObserver(client, editCommentMutation(client, 'PSAPAC-1')).mutate({
      commentId: '7',
      body: text('mine'),
      base,
    })
  const wrote = () => calls.mock.calls.some(([channel]) => channel === 'comments:edit')

  it("refuses with Jira's comment when it changed since the edit began, and writes nothing", async () => {
    jiraHolds([comment('7', 'theirs')])
    await expect(edit(new QueryClient(), text('old'))).rejects.toMatchObject({
      code: 'validation_failed',
      details: { conflict: true, current: text('theirs') },
    })
    expect(wrote()).toBe(false)
  })

  it('saves when Jira still holds the comment the edit began on, whatever the key order', async () => {
    const reordered = { content: text('old').content, type: 'doc' as const, version: 1 as const }
    jiraHolds([comment('7', 'old')])
    await edit(new QueryClient(), reordered)
    expect(wrote()).toBe(true)
  })

  it('refuses a comment deleted in Jira without touching the list or the draft', async () => {
    clearDrafts()
    putDraft(commentDraftKey('PSAPAC-1', '7'), draft(text('old')))
    const client = new QueryClient()
    client.setQueryData(commentsKey('PSAPAC-1'), [comment('7', 'old')])
    jiraHolds([comment('8', 'other')])

    await expect(edit(client, text('old'))).rejects.toMatchObject({ code: 'not_found' })

    expect(wrote()).toBe(false)
    // The row must stay mounted, so its text stays: the list still holds the comment.
    expect(client.getQueryData<CommentItem[]>(commentsKey('PSAPAC-1'))).toEqual([
      comment('7', 'old'),
    ])
    expect(getDraft(commentDraftKey('PSAPAC-1', '7'))).toBeDefined()
    clearDrafts()
  })

  it('reads Jira afresh each time, even with a read already in flight', async () => {
    const client = new QueryClient()
    jiraHolds([comment('7', 'old')])
    await Promise.all([edit(client, text('old')), edit(client, text('old'))])
    const lists = calls.mock.calls.filter(([channel]) => channel === 'comments:list')
    expect(lists).toHaveLength(2)
  })
})

describe('readIssue', () => {
  const one = (summary: string) =>
    ({
      key: 'PSAPAC-1',
      summary,
      status: { id: '1', name: 'To Do', category: 'new' },
      description: null,
      subtasks: [],
    }) as unknown as IssueDetail

  /** A summary edit Jira has not answered yet, so the issue shows its optimistic value. */
  async function editing(client: QueryClient) {
    client.setQueryData(issueDetailKey('PSAPAC-1'), one('One'))
    const held = new Promise<null>(() => undefined)
    void new MutationObserver(
      client,
      summaryMutation(
        client,
        () => held,
        () => Promise.resolve(one('One, edited')),
      ),
    ).mutate({ key: 'PSAPAC-1', summary: 'One, edited' })
    await vi.waitFor(() => {
      expect(client.getQueryData<Issue>(issueDetailKey('PSAPAC-1'))?.summary).toBe('One, edited')
    })
  }

  it('leaves an edit made while the read was out alone', async () => {
    const client = new QueryClient()
    await editing(client)
    calls.mockResolvedValueOnce(one('One'))
    await readIssue(client, 'PSAPAC-1')
    expect(client.getQueryData<Issue>(issueDetailKey('PSAPAC-1'))?.summary).toBe('One, edited')
  })

  it('reloads nothing over an edit in flight when the read fails', async () => {
    const client = new QueryClient()
    await editing(client)
    calls.mockRejectedValueOnce(new JiraMgrError('jira_error', 'Jira is down.'))
    await readIssue(client, 'PSAPAC-1')
    expect(client.getQueryState(issueDetailKey('PSAPAC-1'))?.isInvalidated).toBe(false)
  })
})
