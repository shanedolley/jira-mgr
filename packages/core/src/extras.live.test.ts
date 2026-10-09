import { describe, expect, it } from 'vitest'

import { adfFixtures } from '../test/adf-fixtures.js'
import type { AdfNode } from './adf-schema.js'
import { attachmentMediaId, listAttachments } from './extras.js'
import { createHttpClient } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The media ids of the images a recorded description embeds inline. */
function embeddedIds(number: string): string[] {
  const ids: string[] = []
  const walk = (node: AdfNode) => {
    if (node.type === 'mediaSingle') {
      for (const media of node.content ?? []) {
        if (typeof media.attrs?.id === 'string') ids.push(media.attrs.id)
      }
    }
    node.content?.forEach(walk)
  }
  const fixture = adfFixtures.find((f) => f.name === `adf-description-psapac-${number}`)
  fixture?.doc.content.forEach(walk)
  return ids
}

// Read-only: lists attachments and reads content redirects, nothing else.
describe.runIf(process.env.JM_LIVE_JIRA === '1')('attachment media ids on PSAPAC', () => {
  const http = createHttpClient()

  it('the image attachments of PSAPAC-19 and PSAPAC-1219 resolve to the media ids their descriptions embed', async () => {
    for (const number of ['19', '1219']) {
      const images = (await listAttachments(http, `PSAPAC-${number}`)).filter((a) =>
        a.mimeType?.startsWith('image/'),
      )
      const resolved = await Promise.all(images.map((a) => attachmentMediaId(http, a.id)))
      for (const id of resolved) expect(id).toMatch(UUID)
      const embedded = embeddedIds(number)
      expect(embedded.length).toBeGreaterThan(0)
      for (const id of embedded) expect(resolved).toContain(id)
    }
  })

  it('attachments 652123 and 652124 of PSAPAC-3017 resolve to b779fa03-43a9-473f-bc64-531f0c7fa560 and 2dca82e3-a88f-4cfc-a9e5-1a2f302369b8', async () => {
    const resolved = await Promise.all(
      ['652123', '652124'].map((id) => attachmentMediaId(http, id)),
    )
    expect(new Set(resolved)).toEqual(
      new Set(['b779fa03-43a9-473f-bc64-531f0c7fa560', '2dca82e3-a88f-4cfc-a9e5-1a2f302369b8']),
    )
  })
})
