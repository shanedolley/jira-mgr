import type { AdfDoc, AdfNode, EditorDoc, EditorNode } from '@jira-mgr/core/adf'
import { describe, expect, it } from 'vitest'

import { embedPasted, imageNotes, type EmbedDeps } from './createImages'

const paragraph = (value: string): EditorNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
})
const pending = (uploadId: string): EditorNode => ({
  type: 'adfImage',
  attrs: { node: null, uploadId },
})
const media = (id: string): AdfNode => ({
  type: 'mediaSingle',
  content: [{ type: 'media', attrs: { type: 'file', id } }],
})
const typed: EditorDoc = {
  type: 'doc',
  content: [paragraph('Before'), pending('a'), paragraph('Middle'), pending('b')],
}
const adfParagraph = (value: string): AdfNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
})
const base: AdfDoc = {
  version: 1,
  type: 'doc',
  content: [adfParagraph('Before'), adfParagraph('Middle')],
}

function deps(overrides: Partial<EmbedDeps> = {}): EmbedDeps & {
  uploaded: string[]
  saved: { description: AdfDoc; base: AdfDoc | null }[]
} {
  const uploaded: string[] = []
  const saved: { description: AdfDoc; base: AdfDoc | null }[] = []
  return {
    uploaded,
    saved,
    upload: (id) => {
      uploaded.push(id)
      return Promise.resolve({ node: media(`media-${id}`) })
    },
    name: (id) => `${id}.png`,
    save: (description, against) => {
      saved.push({ description, base: against })
      return Promise.resolve('saved')
    },
    ...overrides,
  }
}

describe('embedPasted', () => {
  it('uploads each image in order, then writes the description once with them in place', async () => {
    const held = deps()
    const result = await embedPasted(typed, base, held)

    expect(held.uploaded).toEqual(['a', 'b'])
    expect(result).toEqual({ failed: [], patch: null, uploaded: 2 })
    expect(held.saved).toEqual([
      {
        base,
        description: {
          version: 1,
          type: 'doc',
          content: [paragraph('Before'), media('media-a'), paragraph('Middle'), media('media-b')],
        },
      },
    ])
  })

  it('leaves a failed image out, names it, and still writes the others', async () => {
    const held = deps({
      upload: (id) =>
        Promise.resolve(id === 'a' ? { failed: 'Jira said no.' } : { node: media('media-b') }),
    })
    const result = await embedPasted(typed, base, held)

    expect(result).toEqual({
      failed: [{ name: 'a.png', reason: 'Jira said no.' }],
      patch: null,
      uploaded: 1,
    })
    expect(held.saved[0]?.description.content).toEqual([
      paragraph('Before'),
      paragraph('Middle'),
      media('media-b'),
    ])
  })

  it('treats a rejected upload as a failure and goes on', async () => {
    const held = deps({
      upload: (id) =>
        id === 'a' ? Promise.reject(new Error('Boom.')) : Promise.resolve({ node: media('m') }),
    })
    expect((await embedPasted(typed, base, held)).failed).toEqual([
      { name: 'a.png', reason: 'Boom.' },
    ])
  })

  it('writes nothing when no image uploaded', async () => {
    const held = deps({ upload: () => Promise.resolve({ failed: 'No.' }) })
    const result = await embedPasted(typed, base, held)
    expect(result).toMatchObject({ patch: null, uploaded: 0 })
    expect(result.failed).toHaveLength(2)
    expect(held.saved).toEqual([])
  })

  it('does nothing for a document with no pasted image', async () => {
    const held = deps()
    const text: EditorDoc = { type: 'doc', content: [paragraph('Only text')] }
    expect(await embedPasted(text, base, held)).toEqual({ failed: [], patch: null, uploaded: 0 })
    expect(held.uploaded).toEqual([])
    expect(held.saved).toEqual([])
  })

  it('reports a description that changed in Jira, and one the write failed on', async () => {
    const changed = deps({ save: () => Promise.resolve('changed') })
    expect(await embedPasted(typed, base, changed)).toMatchObject({
      patch: { kind: 'changed' },
      uploaded: 2,
    })
    const failed = deps({ save: () => Promise.reject(new Error('Jira said 500.')) })
    expect(await embedPasted(typed, base, failed)).toMatchObject({
      patch: { kind: 'failed', reason: 'Jira said 500.' },
      uploaded: 2,
    })
  })
})

describe('imageNotes', () => {
  it('has no note when everything landed', () => {
    expect(imageNotes('P-9', { failed: [], patch: null, uploaded: 1 })).toEqual([])
  })

  it('names a failed image, the issue and that the description lacks it', () => {
    expect(
      imageNotes('P-9', {
        failed: [{ name: 'shot.png', reason: 'Jira said no.' }],
        patch: null,
        uploaded: 0,
      }),
    ).toEqual(['Could not attach shot.png to P-9. Jira said no. It is not in the description.'])
  })

  it('says the images are attached when the description could not take them', () => {
    expect(imageNotes('P-9', { failed: [], patch: { kind: 'changed' }, uploaded: 1 })).toEqual([
      'The description of P-9 changed in Jira, so the pasted image was attached to it but not placed in the description.',
    ])
    expect(
      imageNotes('P-9', {
        failed: [],
        patch: { kind: 'failed', reason: 'Jira said 500.' },
        uploaded: 2,
      }),
    ).toEqual([
      'Could not put the pasted images into the description of P-9. Jira said 500. They are attached to the issue.',
    ])
  })
})
