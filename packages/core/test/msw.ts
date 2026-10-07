import { readFileSync } from 'node:fs'

import { http, HttpResponse, type JsonBodyType } from 'msw'
import { setupServer } from 'msw/node'

export const JIRA_SITE = 'https://engineering-collibra.atlassian.net'

export const server = setupServer()

const fixturesDir = new URL('../fixtures/', import.meta.url)

/** Reads a recorded fixture, parsed. */
export function loadFixture(name: string): JsonBodyType {
  return JSON.parse(readFileSync(new URL(`${name}.json`, fixturesDir), 'utf8')) as JsonBodyType
}

/** Answers `method path` on the Jira site origin with the recorded fixture. */
export function serveFixture(method: 'get' | 'post', path: string, name: string): void {
  server.use(http[method](`${JIRA_SITE}${path}`, () => HttpResponse.json(loadFixture(name))))
}
