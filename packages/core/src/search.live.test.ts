import { beforeAll, describe, expect, it } from 'vitest'

import { server } from '../test/msw.js'
import { createHttpClient } from './http.js'
import { searchText } from './search.js'

// Read-only: runs `text ~` searches against PSAPAC, nothing else.
describe.runIf(process.env.JM_LIVE_JIRA === '1')(
  'text search on PSAPAC',
  { timeout: 30_000 },
  () => {
    // The shared setup fails any request with no MSW handler, and a live test needs the network.
    beforeAll(() => {
      server.close()
    })

    const http = createHttpClient()

    it('finds PSAPAC-1219 by a word only its description holds', async () => {
      const found = await searchText(http, 'prioritised')
      expect(found.map((i) => i.key)).toContain('PSAPAC-1219')
    })

    it('answers text holding a tab instead of failing', async () => {
      await expect(searchText(http, 'prioritised\tplan')).resolves.toBeInstanceOf(Array)
    })
  },
)
