import {
  adfToEditor,
  editorToAdf,
  equivalentAdf,
  type AdfNode,
  type EditorNode,
} from '@jira-mgr/core/adf'
import { adfFixtures } from '@jira-mgr/core/test/adf-fixtures'
import { describe, expect, it } from 'vitest'

import { createClipGuard, editorSchema, readAdfAttr, schemaAccepts } from './extensions'

/** What a top-level block may hold and stay editable, named without reading the converter. */
const EDITABLE = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'rule',
])
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function readOnly(node: AdfNode): boolean {
  if (node.type === 'mediaSingle') return node.content?.[0]?.attrs?.type !== 'file'
  if (!EDITABLE.has(node.type)) return true
  if (TEXT_BLOCKS.has(node.type)) return false
  return (node.content ?? []).some(readOnly)
}

const docs = adfFixtures.map((f) => [f.name, f.doc] as const)

describe('the editor schema', () => {
  it('has fixtures to test', () => {
    expect(docs.length).toBeGreaterThanOrEqual(25)
  })

  it.each(docs)('accepts %s with no block refused', (_name, adf) => {
    expect(adfToEditor(adf, { accepts: schemaAccepts })).toStrictEqual(adfToEditor(adf))
  })

  it.each(docs)('lets %s survive nodeFromJSON, toJSON and editorToAdf unchanged', (_name, adf) => {
    const editor = adfToEditor(adf, { accepts: schemaAccepts })
    const node = editorSchema.nodeFromJSON(editor)
    node.check()
    const back = editorToAdf(node.toJSON() as typeof editor)
    expect(back).not.toBeNull()
    expect(equivalentAdf(back, adf)).toBe(true)
  })

  it('makes read-only exactly the top-level blocks the oracle names, through the schema', () => {
    for (const { name, doc } of adfFixtures) {
      const node = editorSchema.nodeFromJSON(adfToEditor(doc, { accepts: schemaAccepts }))
      const actual: string[] = []
      node.forEach((block) => actual.push(block.type.name))
      const expected = doc.content.map((block) => (readOnly(block) ? 'adfBlock' : null))
      expect(
        actual.map((type) => (type === 'adfBlock' ? 'adfBlock' : null)),
        name,
      ).toEqual(expected)
    }
    // Editable content survives in the three documents that mix it with read-only blocks.
    for (const number of ['3017', '550', '1219']) {
      const fixture = adfFixtures.find((f) => f.name === `adf-description-psapac-${number}`)
      const types = adfToEditor(
        fixture?.doc ?? { version: 1, type: 'doc', content: [] },
      ).content.map((n) => n.type)
      expect(
        types.some((type) => type !== 'adfBlock'),
        number,
      ).toBe(true)
    }
  })

  it('loads a block the schema refuses as a read-only block instead of throwing', () => {
    const doc = {
      version: 1 as const,
      type: 'doc' as const,
      content: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'strong' }] }],
        },
      ],
    }
    expect(adfToEditor(doc, { accepts: schemaAccepts }).content[0]?.type).toBe('adfBlock')
  })

  it('a heading, rule or quote cannot sit in a list item or a quote', () => {
    const para = { type: 'paragraph' }
    const heading = { type: 'heading', attrs: { level: 2 } }
    const rule = { type: 'horizontalRule' }
    const quote = { type: 'blockquote', content: [para] }
    for (const bad of [heading, rule, quote]) {
      expect(schemaAccepts({ type: 'listItem', content: [para, bad] }), bad.type).toBe(false)
      expect(schemaAccepts({ type: 'blockquote', content: [para, bad] }), bad.type).toBe(false)
    }
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [para] }] }
    const code = { type: 'codeBlock' }
    expect(schemaAccepts({ type: 'listItem', content: [para, list, code] })).toBe(true)
    expect(schemaAccepts({ type: 'blockquote', content: [para, list, code] })).toBe(true)
  })

  it('linked code keeps both marks', () => {
    const run = (marks: { type: string; attrs?: Record<string, unknown> }[]) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks }],
    })
    const link = { type: 'link', attrs: { href: 'https://example.test' } }
    expect(schemaAccepts(run([{ type: 'code' }, link]))).toBe(true)
    expect(schemaAccepts(run([{ type: 'code' }, { type: 'bold' }]))).toBe(false)
    expect(
      schemaAccepts(run([{ type: 'adfMark', attrs: { mark: { type: 'textColor' } } }, link])),
    ).toBe(true)
  })

  it('the editor names every node and mark the converter emits', () => {
    const nodes = new Set<string>()
    const marks = new Set<string>()
    const walk = (node: EditorNode) => {
      nodes.add(node.type)
      for (const mark of node.marks ?? []) marks.add(mark.type)
      node.content?.forEach(walk)
    }
    for (const { doc } of adfFixtures) adfToEditor(doc).content.forEach(walk)
    // Types the fixtures lack: an image, a rule, an unknown mark, a break, a quote and an inline atom.
    const synthetic = adfToEditor({
      version: 1,
      type: 'doc',
      content: [
        { type: 'rule' },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
        {
          type: 'mediaSingle',
          content: [
            { type: 'media', attrs: { type: 'file', id: 'f06ee6e2-999b-491f-acb0-f299310206ec' } },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'hardBreak' },
            { type: 'text', text: 'x', marks: [{ type: 'textColor', attrs: { color: '#fff' } }] },
            { type: 'emoji', attrs: { shortName: ':a:' } },
          ],
        },
      ],
    })
    synthetic.content.forEach(walk)
    for (const type of nodes) expect(editorSchema.nodes[type], type).toBeDefined()
    for (const type of marks) expect(editorSchema.marks[type], type).toBeDefined()
    for (const type of ['adfBlock', 'adfInline', 'adfImage', 'horizontalRule', 'hardBreak']) {
      expect(nodes.has(type), type).toBe(true)
    }
  })

  it('readAdfAttr refuses invalid JSON, an inline node for a block, and a block for an inline', () => {
    const mention = JSON.stringify({ type: 'mention', attrs: { id: 'u' } })
    const panel = JSON.stringify({ type: 'panel', content: [] })
    expect(readAdfAttr('{not json', 'block')).toBeNull()
    expect(readAdfAttr(null, 'block')).toBeNull()
    expect(readAdfAttr('[]', 'block')).toBeNull()
    expect(readAdfAttr('{"attrs":{}}', 'block')).toBeNull()
    expect(readAdfAttr(mention, 'block')).toBeNull()
    expect(readAdfAttr(panel, 'inline')).toBeNull()
    expect(readAdfAttr(panel, 'block')).toMatchObject({ type: 'panel' })
    expect(readAdfAttr(mention, 'inline')).toMatchObject({ type: 'mention' })
    // A type core has never seen could be either kind, as core treats it.
    const unknown = JSON.stringify({ type: 'futureNode' })
    expect(readAdfAttr(unknown, 'block')).toMatchObject({ type: 'futureNode' })
    expect(readAdfAttr(unknown, 'inline')).toMatchObject({ type: 'futureNode' })
  })
})

describe('the clip guard', () => {
  const html = (nonce: string) => `<p data-jm-clip="${nonce}">x</p>`

  it('trusts only HTML stamped with the latest copy, so an older copy cannot carry ADF back', () => {
    const guard = createClipGuard()
    expect(guard.trusts(html('anything'))).toBe(false)
    const first = guard.next()
    expect(guard.trusts(html(first))).toBe(true)
    expect(guard.trusts('<p>no stamp</p>')).toBe(false)
    const second = guard.next()
    expect(second).not.toBe(first)
    expect(guard.trusts(html(first))).toBe(false)
    expect(guard.trusts(html(second))).toBe(true)
  })
})
