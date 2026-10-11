import type { AdfNode } from '@jira-mgr/core/adf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AddImageArgs } from '../../shared/ipc'
import {
  commitUpload,
  getUpload,
  pastedName,
  releasePreview,
  removeUpload,
  removeUploadsOf,
  resetUploads,
  retryUpload,
  stageUpload,
  startUpload,
  STAGED_KEY,
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

  it("removes the uploads of one issue and leaves the others' alone", () => {
    const store = deps(() => new Promise(() => undefined))
    const a = startUpload('PSAPAC-1', png(), store)
    const b = startUpload('PSAPAC-2', png(), store)
    const c = startUpload('PSAPAC-1', png(), store)
    removeUploadsOf('PSAPAC-1')
    expect([getUpload(a), getUpload(c)]).toEqual([undefined, undefined])
    expect(getUpload(b)).toBeDefined()
    expect(store.revoked.sort()).toEqual(['blob:preview-1', 'blob:preview-3'])
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

  describe('staged for the create dialog', () => {
    it('sends nothing until it is committed, then uploads to the new issue and keeps its staged key', async () => {
      const sent: AddImageArgs[] = []
      const store = deps((args) => {
        sent.push(args)
        return Promise.resolve({ node })
      })
      const id = stageUpload(png(), store)
      await Promise.resolve()
      expect(sent).toEqual([])
      expect(getUpload(id)).toMatchObject({
        key: STAGED_KEY,
        filename: 'shot.png',
        preview: 'blob:preview-1',
        state: { status: 'staged' },
      })

      const pending = commitUpload(id, 'PSAPAC-2000')
      expect(getUpload(id)?.state.status).toBe('uploading')
      expect(await pending).toEqual({ status: 'done', node })
      expect(sent).toMatchObject([{ key: 'PSAPAC-2000', filename: 'shot.png' }])
      // The placeholder in the dialog still finds its upload under the dialog's own key.
      expect(getUpload(id)?.key).toBe(STAGED_KEY)
    })

    it('reports a failed upload and an upload it does not hold', async () => {
      const store = deps(() => Promise.reject(new Error('Jira refused.')))
      const id = stageUpload(png(), store)
      expect(await commitUpload(id, 'PSAPAC-2000')).toEqual({
        status: 'failed',
        message: 'Jira refused.',
      })
      // Committed twice, or never staged: nothing is sent again.
      expect(await commitUpload(id, 'PSAPAC-2000')).toMatchObject({ status: 'failed' })
      expect(await commitUpload('nope', 'PSAPAC-2000')).toEqual({
        status: 'failed',
        message: 'The pasted image was lost.',
      })
    })

    it('is removed with the dialog, preview and all', () => {
      const store = deps(() => Promise.resolve({ node }))
      const id = stageUpload(png(), store)
      removeUploadsOf(STAGED_KEY)
      expect(getUpload(id)).toBeUndefined()
      expect(store.revoked).toEqual(['blob:preview-1'])
    })
  })
})

describe('pastedName', () => {
  it('numbers a clipboard image and keeps its type, bytes and extension', async () => {
    const named = pastedName(
      new File([new Uint8Array([1, 2])], 'image.PNG', { type: 'image/png' }),
      3,
    )
    expect(named.name).toBe('pasted-3.png')
    expect(named.type).toBe('image/png')
    expect([...new Uint8Array(await named.arrayBuffer())]).toEqual([1, 2])
  })

  it('takes the extension from the type when the name has none', () => {
    expect(pastedName(new File([''], 'blob', { type: 'image/jpeg' }), 1).name).toBe('pasted-1.jpg')
    expect(pastedName(new File([''], 'image.', { type: 'image/webp' }), 2).name).toBe(
      'pasted-2.webp',
    )
  })
})
