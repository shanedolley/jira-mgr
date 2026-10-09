import { JiraMgrError } from '@jira-mgr/core'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { LinksResult } from '../../shared/ipc'
import { removeMutation } from './activityQueries'
import { activityKey, clearAccountData, commentsKey, linksKey } from './queries'

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
