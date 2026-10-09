import { readdirSync, readFileSync } from 'node:fs'

import type { AdfDoc } from '../src/adf-schema.js'

/** One recorded ADF document: a description or a comment body, named for its file. */
export interface AdfFixture {
  name: string
  doc: AdfDoc
}

const dir = new URL('../fixtures/', import.meta.url)
const names = readdirSync(dir)
  .filter((file) => /^adf-(description|comments)-/.test(file))
  .map((file) => file.replace(/\.json$/, ''))
  .sort()

/** Every ADF document in `fixtures/adf-*.json`: each description and each comment body. */
export const adfFixtures: AdfFixture[] = names.flatMap((name) => {
  const body = JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8')) as {
    fields?: { description: AdfDoc | null }
    comments?: { id: string; body: AdfDoc }[]
  }
  const docs: AdfFixture[] = []
  if (body.fields?.description) docs.push({ name, doc: body.fields.description })
  for (const comment of body.comments ?? []) {
    docs.push({ name: `${name} comment ${comment.id}`, doc: comment.body })
  }
  return docs
})
