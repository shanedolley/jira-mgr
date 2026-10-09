import { describe, expect, it } from 'vitest'

import { adfFixtures } from '../test/adf-fixtures.js'
import {
  adfToEditor,
  editorToAdf,
  equivalentAdf,
  imageNode,
  sameAdf,
  type AdfDoc,
  type AdfNode,
  type EditorDoc,
  type EditorNode,
} from './adf.js'
import { JiraMgrError } from './errors.js'

const doc = (...content: AdfNode[]): AdfDoc => ({ version: 1, type: 'doc', content })
const text = (value: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]) =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const para = (...content: AdfNode[]): AdfNode =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }

const roundTrip = (adf: AdfDoc) => editorToAdf(adfToEditor(adf))

/** The types a top-level block may hold and still be editable, named without reading the converter. */
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
const textBlocks = new Set(['paragraph', 'heading', 'codeBlock'])

function readsOnly(node: AdfNode): boolean {
  if (node.type === 'mediaSingle') return !(node.content?.[0]?.attrs?.type === 'file')
  if (!EDITABLE.has(node.type)) return true
  if (textBlocks.has(node.type)) return false
  return (node.content ?? []).some(readsOnly)
}

function countInline(node: AdfNode): number {
  if (textBlocks.has(node.type)) {
    return (node.content ?? []).filter((n) => n.type !== 'text' && n.type !== 'hardBreak').length
  }
  return (node.content ?? []).reduce((sum, n) => sum + countInline(n), 0)
}

function countEditor(node: EditorNode, type: string): number {
  return (
    (node.type === type ? 1 : 0) +
    (node.content ?? []).reduce((sum, n) => sum + countEditor(n, type), 0)
  )
}

const editorOf = (editor: EditorDoc, type: string) =>
  editor.content.reduce((sum, n) => sum + countEditor(n, type), 0)

describe('the editor converter on recorded PSAPAC content', () => {
  it('has fixtures to test', () => {
    expect(adfFixtures.length).toBeGreaterThanOrEqual(25)
  })

  it.each(adfFixtures.map((f) => [f.name, f.doc] as const))(
    'round-trips %s through the editor form',
    (_name, adf) => {
      const back = roundTrip(adf)
      expect(back).not.toBeNull()
      expect(equivalentAdf(back, adf)).toBe(true)
    },
  )

  it('makes read-only exactly the top-level blocks the oracle names, in every fixture', () => {
    for (const { name, doc: adf } of adfFixtures) {
      const editor = adfToEditor(adf)
      const expected = adf.content.filter(readsOnly).length
      // Image blocks are their own node and not read-only.
      const actual = editor.content.filter((n) => n.type === 'adfBlock').length
      expect(actual, name).toBe(expected)
      const inline = adf.content
        .filter((b) => !readsOnly(b))
        .reduce((s, b) => s + countInline(b), 0)
      expect(
        editorOf(
          { ...editor, content: editor.content.filter((n) => n.type !== 'adfBlock') },
          'adfInline',
        ),
        name,
      ).toBe(inline)
    }
  })

  it.each(['3017', '550', '1219'])(
    'keeps paragraphs, headings, lists and code blocks editable in PSAPAC-%s',
    (number) => {
      const fixture = adfFixtures.find((f) => f.name === `adf-description-psapac-${number}`)
      expect(fixture).toBeDefined()
      const editor = adfToEditor((fixture as { doc: AdfDoc }).doc)
      const editable = editorOf(editor, 'paragraph') + editorOf(editor, 'heading')
      expect(editable).toBeGreaterThan(0)
      expect(editor.content.some((n) => n.type !== 'adfBlock')).toBe(true)
    },
  )
})

describe('adfToEditor and editorToAdf', () => {
  it('maps strong, em, strike, code, underline and link to the editor marks and back', () => {
    const adf = doc(
      para(
        text('a', { type: 'strong' }),
        text('b', { type: 'em' }),
        text('c', { type: 'strike' }),
        text('d', { type: 'code' }),
        text('e', { type: 'underline' }),
        text('f', { type: 'link', attrs: { href: 'https://x.test', title: 'T' } }),
      ),
    )
    const editor = adfToEditor(adf)
    const marks = editor.content[0]?.content?.flatMap((n) => n.marks?.map((m) => m.type) ?? [])
    expect(marks).toEqual(['bold', 'italic', 'strike', 'code', 'underline', 'link'])
    expect(roundTrip(adf)).toStrictEqual(adf)
  })

  it('keeps textColor and other unknown marks, several on one text', () => {
    const adf = doc(
      para(
        text(
          'red',
          { type: 'textColor', attrs: { color: '#f00' } },
          { type: 'backgroundColor', attrs: { color: '#0f0' } },
          { type: 'strong' },
        ),
      ),
    )
    const editor = adfToEditor(adf)
    expect(editor.content[0]?.type).toBe('paragraph')
    expect(
      editor.content[0]?.content?.[0]?.marks?.filter((m) => m.type === 'adfMark'),
    ).toHaveLength(2)
    expect(equivalentAdf(roundTrip(adf), adf)).toBe(true)
  })

  it('keeps localId on paragraphs, lists and list items, and block marks such as alignment', () => {
    const adf = doc(
      {
        type: 'paragraph',
        attrs: { localId: 'p' },
        marks: [{ type: 'alignment', attrs: { align: 'end' } }],
        content: [text('x')],
      },
      {
        type: 'bulletList',
        attrs: { localId: 'l' },
        content: [{ type: 'listItem', attrs: { localId: 'i' }, content: [para(text('y'))] }],
      },
    )
    const editor = adfToEditor(adf)
    expect(editor.content.map((n) => n.type)).toEqual(['paragraph', 'bulletList'])
    expect(roundTrip(adf)).toStrictEqual(adf)
  })

  it('writes a changed level, order, language or href over the original attrs', () => {
    const adf = doc(
      { type: 'heading', attrs: { level: 2, localId: 'h' }, content: [text('t')] },
      {
        type: 'orderedList',
        attrs: { order: 1 },
        content: [{ type: 'listItem', content: [para(text('a'))] }],
      },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [text('x')] },
      para(text('l', { type: 'link', attrs: { href: 'https://a.test' } })),
    )
    const editor = structuredClone(adfToEditor(adf))
    const [heading, list, code, link] = editor.content as [
      EditorNode,
      EditorNode,
      EditorNode,
      EditorNode,
    ]
    if (heading.attrs) heading.attrs.level = 3
    if (list.attrs) list.attrs.start = 4
    if (code.attrs) code.attrs.language = 'ts'
    const mark = link.content?.[0]?.marks?.[0]
    if (mark?.attrs) mark.attrs.href = 'https://b.test'
    expect(editorToAdf(editor)?.content).toEqual([
      { type: 'heading', attrs: { level: 3, localId: 'h' }, content: [text('t')] },
      {
        type: 'orderedList',
        attrs: { order: 4 },
        content: [{ type: 'listItem', content: [para(text('a'))] }],
      },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('x')] },
      para(text('l', { type: 'link', attrs: { href: 'https://b.test' } })),
    ])
  })

  it('writes no order for a new list starting at 1, and order for one starting elsewhere', () => {
    const item = { type: 'listItem', content: [{ type: 'paragraph' }] }
    const editor: EditorDoc = {
      type: 'doc',
      content: [
        { type: 'orderedList', attrs: { start: 1 }, content: [item] },
        { type: 'orderedList', attrs: { start: 3 }, content: [item] },
      ],
    }
    const out = editorToAdf(editor)?.content
    expect(out?.[0]?.attrs).toBeUndefined()
    expect(out?.[1]?.attrs).toEqual({ order: 3 })
    const loaded = doc({ type: 'orderedList', content: [{ type: 'listItem', content: [para()] }] })
    expect(roundTrip(loaded)?.content[0]?.attrs).toBeUndefined()
  })

  it("drops TipTap's default link and code block attrs", () => {
    const editor: EditorDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'l',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://a.test', target: '_blank', rel: 'x', class: 'y' },
                },
              ],
            },
          ],
        },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'c' }] },
      ],
    }
    expect(editorToAdf(editor)?.content).toEqual([
      para(text('l', { type: 'link', attrs: { href: 'https://a.test' } })),
      { type: 'codeBlock', content: [text('c')] },
    ])
  })

  it('ignores marks on read-only atoms', () => {
    const mention = { type: 'mention', attrs: { id: 'u1', text: '@A' } }
    const adf = doc(para(mention), {
      type: 'panel',
      attrs: { panelType: 'info' },
      content: [para(text('p'))],
    })
    const editor = structuredClone(adfToEditor(adf))
    const atom = editor.content[0]?.content?.[0]
    if (atom) atom.marks = [{ type: 'bold' }]
    const block = editor.content[1]
    if (block) block.marks = [{ type: 'bold' }]
    expect(editorToAdf(editor)).toStrictEqual(adf)
  })

  it('keeps mention, date, emoji, status, inlineCard and mediaInline as read-only inline nodes', () => {
    const inline = [
      { type: 'mention', attrs: { id: 'u', text: '@A' } },
      { type: 'date', attrs: { timestamp: '1' } },
      { type: 'emoji', attrs: { shortName: ':a:' } },
      { type: 'status', attrs: { text: 'ok', color: 'green' } },
      { type: 'inlineCard', attrs: { url: 'https://x.test' } },
      { type: 'mediaInline', attrs: { id: 'm', collection: '', type: 'file' } },
    ]
    const adf = doc(para(text('a '), ...inline, text(' b')))
    const editor = adfToEditor(adf)
    expect(editor.content[0]?.content?.filter((n) => n.type === 'adfInline')).toHaveLength(6)
    expect(roundTrip(adf)).toStrictEqual(adf)
  })

  it('loads a mediaSingle of a file as an image, and an external one as a read-only block', () => {
    const file = imageNode({ mediaId: 'f06ee6e2-999b-491f-acb0-f299310206ec', filename: 'a.png' })
    const external = {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [{ type: 'media', attrs: { type: 'external', url: 'https://x.test/a.png' } }],
    }
    const editor = adfToEditor(doc(file, external))
    expect(editor.content.map((n) => n.type)).toEqual(['adfImage', 'adfBlock'])
    expect(roundTrip(doc(file, external))).toStrictEqual(doc(file, external))
  })

  it('loads a block that does not come back equivalent as a read-only block', () => {
    const odd = { type: 'paragraph', content: [{ type: 'text', text: 'x', extra: 1 }] }
    const emptyMarks = { type: 'paragraph', content: [{ type: 'text', text: 'y', marks: [] }] }
    const badAttrs = { type: 'paragraph', attrs: null, content: [text('z')] }
    const editor = adfToEditor(
      doc(odd, emptyMarks, badAttrs as unknown as AdfNode, para(text('ok'))),
    )
    expect(editor.content.map((n) => n.type)).toEqual([
      'adfBlock',
      'adfBlock',
      'adfBlock',
      'paragraph',
    ])
    expect(editor.content[0]?.attrs?.node).toStrictEqual(odd)
  })

  it('loads a block the accepts check refuses as a read-only block', () => {
    const adf = doc(para(text('a')), { type: 'heading', attrs: { level: 1 }, content: [text('h')] })
    const editor = adfToEditor(adf, { accepts: (block) => block.type !== 'heading' })
    expect(editor.content.map((n) => n.type)).toEqual(['paragraph', 'adfBlock'])
  })

  it('joins adjacent text with the same marks, and compares marks as a set', () => {
    const split = doc(para(text('a', { type: 'strong' }), text('b', { type: 'strong' }), text('c')))
    const joined = adfToEditor(split).content[0]?.content
    expect(joined).toHaveLength(2)
    expect(joined?.[0]?.text).toBe('ab')
    const one = doc(para(text('x', { type: 'strong' }, { type: 'em' })))
    const two = doc(para(text('x', { type: 'em' }, { type: 'strong' })))
    expect(equivalentAdf(one, two)).toBe(true)
    expect(equivalentAdf(one, doc(para(text('x', { type: 'em' }))))).toBe(false)
    expect(equivalentAdf(split, doc(para(text('ab', { type: 'strong' }), text('c'))))).toBe(true)
  })

  it('treats a paragraph with no content and one with empty content as equal', () => {
    expect(equivalentAdf(doc({ type: 'paragraph' }), doc({ type: 'paragraph', content: [] }))).toBe(
      true,
    )
    expect(sameAdf({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('saves a document holding only an empty paragraph as no description', () => {
    expect(editorToAdf({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull()
    expect(editorToAdf(adfToEditor(doc()))).toBeNull()
    expect(adfToEditor(doc()).content).toEqual([{ type: 'paragraph' }])
    expect(roundTrip(doc(para(text('a'))))).not.toBeNull()
  })

  it('refuses an image still uploading with validation_failed', () => {
    const editor: EditorDoc = {
      type: 'doc',
      content: [{ type: 'adfImage', attrs: { node: null, uploadId: 'u1' } }],
    }
    expect(() => editorToAdf(editor)).toThrow(JiraMgrError)
    try {
      editorToAdf(editor)
    } catch (error) {
      expect((error as JiraMgrError).code).toBe('validation_failed')
    }
  })

  it('imageNode builds the mediaSingle Jira writes for an attachment', () => {
    expect(
      imageNode({ mediaId: 'abc', filename: 'shot.png', width: 10, height: 20 }),
    ).toStrictEqual({
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        {
          type: 'media',
          attrs: {
            type: 'file',
            id: 'abc',
            collection: '',
            alt: 'shot.png',
            width: 10,
            height: 20,
          },
        },
      ],
    })
    expect(imageNode({ mediaId: 'abc', filename: 'a.png' }).content?.[0]?.attrs).not.toHaveProperty(
      'width',
    )
  })

  it('refuses a document nested past the stack with validation_failed', () => {
    let deep: AdfNode = para(text('x'))
    for (let i = 0; i < 20_000; i++) deep = { type: 'blockquote', content: [deep] }
    try {
      adfToEditor(doc(deep))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(JiraMgrError)
      expect((error as JiraMgrError).code).toBe('validation_failed')
    }
  })
})
