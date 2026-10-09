import type { AdfNode } from '@jira-mgr/core/adf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AddImageArgs } from '../../shared/ipc'
import {
  getUpload,
  releasePreview,
  removeUpload,
  resetUploads,
  retryUpload,
  startUpload,
  type UploadDeps,
} from './uploads'

afterEach(() => {
  resetUploads()
})

const node: AdfNode = { type: 'mediaSingle', content: [] }
const png = () => new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

function deps(send: UploadDeps['send']): UploadDeps & { revoked: string[] } {
  const revoked: string[] = []
  let urls = 0
  return {
    send,
    measure: () => Promise.resolve({ width: 4, height: 3 }),
    createUrl: () => `blob:preview-${String(++urls)}`,
    revokeUrl: (url) => {
      revoked.push(url)
    },
    revoked,
  }
}

describe('uploads', () => {
  it("keeps an upload's result until a view applies it", async () => {
    const sent: AddImageArgs[] = []
    const store = deps((args) => {
      sent.push(args)
      return Promise.resolve({ node })
    })
    const id = startUpload('PSAPAC-1', png(), store)
    expect(getUpload(id)?.state).toEqual({ status: 'uploading' })
    expect(getUpload(id)?.preview).toBe('blob:preview-1')
    await vi.waitFor(() => {
      expect(getUpload(id)?.state).toEqual({ status: 'done', node })
    })
    expect(sent).toMatchObject([
      { key: 'PSAPAC-1', filename: 'shot.png', mimeType: 'image/png', width: 4, height: 3 },
    ])
    expect([...(sent[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    // Nothing removes the result but a view that applies it, or a logout.
    expect(getUpload(id)?.state.status).toBe('done')
  })

  it('shows a failure, and tries again from retry', async () => {
    let fail = true
    const store = deps(() =>
      fail ? Promise.reject(new Error('Jira refused.')) : Promise.resolve({ node }),
    )
    const id = startUpload('PSAPAC-1', png(), store)
    await vi.waitFor(() => {
      expect(getUpload(id)?.state).toEqual({ status: 'failed', message: 'Jira refused.' })
    })
    fail = false
    retryUpload(id)
    expect(getUpload(id)?.state.status).toBe('uploading')
    await vi.waitFor(() => {
      expect(getUpload(id)?.state.status).toBe('done')
    })
  })

  it('releases a preview once, and keeps the result', async () => {
    const store = deps(() => Promise.resolve({ node }))
    const id = startUpload('PSAPAC-1', png(), store)
    await vi.waitFor(() => {
      expect(getUpload(id)?.state.status).toBe('done')
    })
    releasePreview(id)
    releasePreview(id)
    expect(store.revoked).toEqual(['blob:preview-1'])
    expect(getUpload(id)).toMatchObject({ preview: '', state: { status: 'done' } })
  })

  it('removing an upload revokes its preview and forgets it', () => {
    const store = deps(() => Promise.resolve({ node }))
    const id = startUpload('PSAPAC-1', png(), store)
    removeUpload(id)
    expect(getUpload(id)).toBeUndefined()
    expect(store.revoked).toEqual(['blob:preview-1'])
  })

  it('logout removes every upload and revokes its preview', () => {
    const store = deps(() => new Promise(() => undefined))
    const a = startUpload('PSAPAC-1', png(), store)
    const b = startUpload('PSAPAC-2', png(), store)
    resetUploads()
    expect(getUpload(a)).toBeUndefined()
    expect(getUpload(b)).toBeUndefined()
    expect(store.revoked.sort()).toEqual(['blob:preview-1', 'blob:preview-2'])
  })

  it('refuses a file that is not one of the four image types', async () => {
    const store = deps(() => Promise.resolve({ node }))
    const id = startUpload(
      'PSAPAC-1',
      new File([new Uint8Array([1])], 'a.svg', { type: 'image/svg+xml' }),
      store,
    )
    await vi.waitFor(() => {
      expect(getUpload(id)?.state.status).toBe('failed')
    })
  })
})
