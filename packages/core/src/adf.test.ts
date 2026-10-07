import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { loadFixture } from '../test/msw.js'
import { adfToMarkdown, markdownToAdf, type AdfDoc, type AdfMark, type AdfNode } from './adf.js'
import { JiraMgrError } from './errors.js'

const doc = (...content: AdfNode[]): AdfDoc => ({ version: 1, type: 'doc', content })
const text = (value: string, ...marks: AdfMark[]): AdfNode =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const para = (...content: AdfNode[]): AdfNode =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
const mark = (type: string, attrs?: Record<string, unknown>): AdfMark =>
  attrs ? { type, attrs } : { type }
const node = (type: string, attrs?: Record<string, unknown>, ...content: AdfNode[]): AdfNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content.length > 0 ? { content } : {}),
})
const li = (...content: AdfNode[]) => node('listItem', undefined, ...content)
const ul = (...items: AdfNode[]) => node('bulletList', undefined, ...items)
const ol = (order: number, ...items: AdfNode[]) => node('orderedList', { order }, ...items)
const h = (level: number, ...content: AdfNode[]) => node('heading', { level }, ...content)

function roundTrip(adf: AdfDoc): AdfDoc {
  return markdownToAdf(adfToMarkdown(adf))
}

/** Identity, and the Markdown stayed readable: no fence and no inline tag. */
function expectNative(adf: AdfDoc): string {
  const markdown = adfToMarkdown(adf)
  expect(markdown).not.toMatch(/```adf|(?<!\\)<adf-node/)
  expect(markdownToAdf(markdown)).toStrictEqual(adf)
  return markdown
}

function expectLossless(adf: AdfDoc): string {
  const markdown = adfToMarkdown(adf)
  expect(markdownToAdf(markdown)).toStrictEqual(adf)
  return markdown
}

const link = (href: string, title?: string) => mark('link', title ? { href, title } : { href })

describe('recorded PSAPAC content', () => {
  const dir = new URL('../fixtures/', import.meta.url)
  const names = readdirSync(dir)
    .filter((file) => /^adf-(description|comments)-/.test(file))
    .map((file) => file.replace(/\.json$/, ''))
  const docs: [string, AdfDoc][] = []
  for (const name of names) {
    const body = loadFixture(name) as {
      fields?: { description: AdfDoc }
      comments?: { id: string; body: AdfDoc }[]
    }
    if (body.fields) docs.push([name, body.fields.description])
    for (const comment of body.comments ?? [])
      docs.push([`${name} comment ${comment.id}`, comment.body])
  }

  it('has fixtures to test', () => {
    expect(docs.length).toBeGreaterThanOrEqual(25)
  })

  it.each(docs)('round-trips %s with no edits', (_name, adf) => {
    expect(roundTrip(adf)).toStrictEqual(adf)
  })

  it('covers the node and mark types the converter must keep', () => {
    const seen = new Set<string>()
    const walk = (n: AdfNode) => {
      seen.add(n.type)
      for (const m of n.marks ?? []) seen.add(`mark:${m.type}`)
      n.content?.forEach(walk)
    }
    for (const [, adf] of docs) adf.content.forEach(walk)
    for (const type of [
      'bulletList',
      'orderedList',
      'table',
      'panel',
      'mention',
      'mediaSingle',
      'mediaGroup',
      'mediaInline',
      'date',
      'inlineCard',
      'hardBreak',
      'heading',
      'codeBlock',
      'blockquote',
      'mark:strong',
      'mark:em',
      'mark:code',
      'mark:strike',
      'mark:underline',
      'mark:link',
    ]) {
      expect(seen, type).toContain(type)
    }
  })

  it('writes Jira lists, headings and links as plain Markdown', () => {
    const adf = (loadFixture('adf-description-psapac-71') as { fields: { description: AdfDoc } })
      .fields.description
    const markdown = adfToMarkdown(adf)
    expect(markdown).toContain('### **Supported Authentication Methods**')
    expect(markdown).toMatch(/^- `AuthScheme`: OAUTH$/m)
    expect(markdown).not.toContain('<adf-node')
  })
})

describe('adfToMarkdown', () => {
  it('writes marks as Markdown', () => {
    const adf = doc(
      para(
        text('plain '),
        text('bold', mark('strong')),
        text(' '),
        text('em', mark('em')),
        text(' '),
        text('code', mark('code')),
        text(' '),
        text('gone', mark('strike')),
        text(' '),
        text('under', mark('underline')),
        text(' '),
        text('site', link('https://example.com/a', 'Title')),
      ),
    )
    expect(expectNative(adf)).toBe(
      'plain **bold** _em_ `code` ~~gone~~ <u>under</u> [site](https://example.com/a "Title")',
    )
  })

  it('writes headings, rules, quotes and code blocks', () => {
    const adf = doc(
      h(1, text('One')),
      h(6, text('Six')),
      para(text('x')),
      node('rule'),
      node('blockquote', undefined, para(text('quoted')), ul(li(para(text('item'))))),
      node('codeBlock', { language: 'ts' }, text('const a = 1\n\nconst b = 2')),
      node('codeBlock', undefined, text('plain')),
    )
    expect(expectNative(adf)).toBe(
      [
        '# One',
        '',
        '###### Six',
        '',
        'x',
        '',
        '---',
        '',
        '> quoted',
        '>',
        '> - item',
        '',
        '```ts',
        'const a = 1',
        '',
        'const b = 2',
        '```',
        '',
        '```',
        'plain',
        '```',
      ].join('\n'),
    )
  })

  it('writes nested lists with their start number', () => {
    const adf = doc(
      ol(
        3,
        li(para(text('three')), ul(li(para(text('inner'))), li(para(text('inner two'))))),
        li(para(text('four')), para(text('second paragraph'))),
      ),
      ol(0, li(para(text('zero')))),
    )
    expect(expectNative(adf)).toBe(
      [
        '3. three',
        '',
        '   - inner',
        '   - inner two',
        '4. four',
        '',
        '   second paragraph',
        '',
        '<!-- -->',
        '',
        '0. zero',
      ].join('\n'),
    )
  })

  it('keeps two adjacent lists apart', () => {
    expectNative(doc(ul(li(para(text('a')))), ul(li(para(text('b')))), ol(1, li(para(text('c'))))))
  })

  it('writes a header table as GFM', () => {
    const cell = (type: string, value: string) =>
      node(type, {}, para(...(value ? [text(value)] : [])))
    const adf = doc(
      node(
        'table',
        undefined,
        node('tableRow', undefined, cell('tableHeader', 'Name'), cell('tableHeader', 'Note')),
        node('tableRow', undefined, cell('tableCell', 'a | b'), cell('tableCell', '')),
      ),
    )
    expect(expectNative(adf)).toBe(
      ['| Name | Note |', '| --- | --- |', '| a \\| b |  |'].join('\n'),
    )
  })

  it('writes a table with no header row under an empty Markdown header', () => {
    const cell = (value: string) => node('tableCell', {}, para(text(value)))
    const adf = doc(
      node(
        'table',
        { isNumberColumnEnabled: false, layout: 'default', localId: 't1' },
        node('tableRow', { localId: 'r1' }, cell('a'), cell('b')),
        node('tableRow', undefined, cell('c'), cell('d')),
      ),
    )
    expectNative(adf)
  })

  it('keeps table cell attrs, absent or not', () => {
    const adf = doc(
      node(
        'table',
        undefined,
        node(
          'tableRow',
          undefined,
          { type: 'tableHeader', content: [para(text('h'))] },
          node('tableHeader', { background: '#fff', colwidth: [100] }, para(text('i'))),
        ),
        node('tableRow', undefined, node('tableCell', {}, para(text('x'))), {
          type: 'tableCell',
          content: [para(text('y'))],
        }),
      ),
    )
    expectNative(adf)
  })

  it('writes the nodes Markdown cannot express as adf fences', () => {
    const panel = node('panel', { panelType: 'info' }, para(text('careful')))
    const markdown = expectLossless(doc(para(text('before')), panel, para(text('after'))))
    expect(markdown).toBe(
      ['before', '', '```adf', JSON.stringify(panel), '```', '', 'after'].join('\n'),
    )
  })

  it.each([
    ['panel', node('panel', { panelType: 'warning' }, para(text('x')))],
    ['expand', node('expand', { title: 'More' }, para(text('x')))],
    ['nestedExpand', node('nestedExpand', { title: 'More' }, para(text('x')))],
    [
      'mediaSingle',
      node(
        'mediaSingle',
        { layout: 'center', width: 50, widthType: 'pct' },
        {
          type: 'media',
          attrs: { id: 'abc', type: 'file', collection: '', width: 1, height: 2 },
          marks: [link('https://example.com')],
        },
      ),
    ],
    [
      'mediaGroup',
      node('mediaGroup', undefined, node('media', { id: 'abc', type: 'file', collection: '' })),
    ],
    [
      'layoutSection',
      node(
        'layoutSection',
        undefined,
        node('layoutColumn', { width: 50 }, para(text('a'))),
        node('layoutColumn', { width: 50 }, para(text('b'))),
      ),
    ],
    [
      'taskList',
      node(
        'taskList',
        { localId: 'tl' },
        node('taskItem', { localId: 'ti', state: 'TODO' }, text('do it')),
      ),
    ],
    [
      'decisionList',
      node(
        'decisionList',
        { localId: 'dl' },
        node('decisionItem', { localId: 'di', state: 'DECIDED' }, text('chosen')),
      ),
    ],
    [
      'extension',
      node('extension', { extensionType: 'com.x', extensionKey: 'macro', parameters: { a: 1 } }),
    ],
    [
      'bodiedExtension',
      node('bodiedExtension', { extensionType: 'com.x', extensionKey: 'macro' }, para(text('x'))),
    ],
    ['blockCard', node('blockCard', { url: 'https://example.com/card' })],
    ['embedCard', node('embedCard', { url: 'https://example.com/embed', layout: 'wide' })],
    [
      'unknown future block',
      node('quantumBlock', { spin: 'up', nested: { a: [1, 2, { b: null }] } }),
    ],
    ['unknown key on a known block', { type: 'paragraph', content: [text('x')], surprise: true }],
    ['rule with localId', node('rule', { localId: 'r' })],
    [
      'table with merged cells',
      node(
        'table',
        { layout: 'default' },
        node('tableRow', undefined, node('tableCell', { colspan: 2 }, para(text('wide')))),
        node(
          'tableRow',
          undefined,
          node('tableCell', {}, para(text('a'))),
          node('tableCell', {}, para(text('b'))),
        ),
      ),
    ],
    [
      'table cell holding a list',
      node(
        'table',
        undefined,
        node('tableRow', undefined, node('tableCell', {}, ul(li(para(text('x')))))),
      ),
    ],
    [
      'code block in another language called adf',
      node('codeBlock', { language: 'adf' }, text('{"x":1}')),
    ],
    ['empty bullet list', node('bulletList')],
    ['list item with no content', ul(node('listItem'))],
  ])('keeps a %s through a no-edit round trip', (_name, block) => {
    expectLossless(doc(para(text('first')), block, para(text('last'))))
  })

  it('falls back one block at a time, not the whole document', () => {
    // `foo**"bar"**` does not parse as strong, so the first paragraph cannot stay Markdown.
    const tricky = para(text('foo'), text('"bar"', mark('strong')))
    const markdown = expectLossless(doc(para(text('first')), tricky, para(text('last'))))
    expect(markdown.startsWith('first\n\n')).toBe(true)
    expect(markdown.endsWith('\n\nlast')).toBe(true)
  })

  it('keeps unfamiliar blocks inside lists and quotes', () => {
    const panel = node('panel', { panelType: 'note' }, para(text('inside')))
    expectLossless(
      doc(
        ul(li(para(text('item')), panel), li(panel)),
        node('blockquote', undefined, panel),
        node('blockquote', undefined, para(text('q')), panel),
      ),
    )
  })

  it('keeps a document that holds only a fence', () => {
    expectLossless(doc(node('mediaSingle', { layout: 'center' })))
    expectLossless(doc())
  })

  it('keeps an inline node written where a block belongs, below the top level', () => {
    expectLossless(doc(ul(li(text('loose text'), node('mention', { id: '1' })))))
    expectLossless(doc(node('blockquote', undefined, text('loose'))))
  })

  describe('inline nodes', () => {
    const inlineNodes: [string, AdfNode][] = [
      [
        'mention',
        node('mention', { id: '5ce7', text: '@Tony Hoang', accessLevel: '', localId: 'm1' }),
      ],
      ['emoji', node('emoji', { shortName: ':smile:', id: '1f604', text: '\u{1F604}' })],
      ['date', node('date', { timestamp: '1773964800000' })],
      ['status', node('status', { text: 'In progress', color: 'blue', localId: 's1' })],
      [
        'inlineCard with a localId',
        node('inlineCard', { url: 'https://example.com/a', localId: 'c' }),
      ],
      ['inlineCard with data', node('inlineCard', { data: { '@type': 'Document', name: 'Doc' } })],
      ['mediaInline', node('mediaInline', { id: 'abc', collection: '', type: 'file' })],
      ['placeholder', node('placeholder', { text: 'type here' })],
      ['unknown inline', node('hologram', { a: "it's <b>&</b> -->" })],
      [
        'mention with marks',
        { ...node('mention', { id: '1', text: '@A' }), marks: [mark('annotation', { id: 'x' })] },
      ],
    ]

    it.each(inlineNodes)('keeps a %s with its attrs', (_name, inlineNode) => {
      const markdown = expectLossless(
        doc(para(text('a '), inlineNode, text(' b')), para(inlineNode), h(2, inlineNode)),
      )
      expect(markdown).toContain('<adf-node')
    })

    it('writes a plain inlineCard as an autolink', () => {
      const adf = doc(
        para(
          text('see '),
          node('inlineCard', { url: 'https://example.com/a?b=1&c=2' }),
          text(' here'),
        ),
      )
      expect(expectNative(adf)).toBe('see <https://example.com/a?b=1&c=2> here')
    })

    it('shows a readable label inside the tag', () => {
      const markdown = adfToMarkdown(doc(para(node('mention', { id: '1', text: '@Tony' }))))
      expect(markdown).toMatch(/^<adf-node data='.*'>@Tony<\/adf-node>$/)
    })

    it('reads a tag whose data is not an ADF node as text', () => {
      expect(markdownToAdf("<adf-node data='nope'>x</adf-node> y").content).toStrictEqual([
        para(text("<adf-node data='nope'>x</adf-node> y")),
      ])
    })
  })

  describe('marks', () => {
    it.each([
      ['textColor', [mark('textColor', { color: '#ff0000' })]],
      ['subsup', [mark('subsup', { type: 'sub' })]],
      ['backgroundColor', [mark('backgroundColor', { color: '#00ff00' })]],
      ['annotation', [mark('annotation', { id: 'a', annotationType: 'inlineComment' })]],
      [
        'link with a title and an id',
        [link('https://x.test', 'T')].map((m) => ({ ...m, attrs: { ...m.attrs, id: '1' } })),
      ],
      ['link then textColor', [link('https://x.test'), mark('textColor', { color: '#f00' })]],
      ['strong then textColor', [mark('strong'), mark('textColor', { color: '#f00' })]],
      ['code before strong', [mark('code'), mark('strong')]],
      ['em then strong', [mark('em'), mark('strong')]],
      ['strong then em then strike', [mark('strong'), mark('em'), mark('strike')]],
      ['link then underline', [link('https://x.test'), mark('underline')]],
      ['underline then link', [mark('underline'), link('https://x.test')]],
      ['strong with attrs', [mark('strong', { odd: true })]],
      ['an empty marks array', []],
    ])('keeps a %s mark', (name, marks) => {
      const marked: AdfNode = { type: 'text', text: 'word', marks }
      const markdown = expectLossless(doc(para(text('a '), marked, text(' b'))))
      if (name === 'link then underline' || name === 'em then strong') {
        expect(markdown).not.toContain('<adf-node')
      }
    })

    it('keeps the outer-to-inner order of marks', () => {
      expectNative(
        doc(para(text('x', mark('strong'), mark('em')), text('y', mark('em'), mark('strong')))),
      )
    })

    it('shares one wrapper across neighbours with the same outer mark', () => {
      const adf = doc(
        para(
          text('a ', mark('strong')),
          text('b', mark('strong'), mark('em')),
          text(' c', mark('strong')),
        ),
      )
      expectLossless(adf)
      const clean = doc(para(text('a', mark('strong')), text('b', mark('strong'), mark('em'))))
      expect(expectNative(clean)).toBe('**a*b***')
    })

    it('keeps a code mark with backticks, spaces and a mark around it', () => {
      expectNative(
        doc(
          para(
            text('a`b', mark('code')),
            text(' '),
            text('``', mark('code')),
            text(' '),
            text(' padded ', mark('code')),
            text(' '),
            text('both', mark('strong'), mark('code')),
            text(' '),
            text('through', link('https://x.test'), mark('code')),
          ),
        ),
      )
    })

    it('keeps spaces inside a mark', () => {
      expectLossless(
        doc(
          para(text('Note: ', mark('strong')), text('after'), text(' lead', mark('em')), text('x')),
        ),
      )
    })

    it('keeps two text runs with the same marks apart', () => {
      expectLossless(
        doc(para(text('a'), text('b')), para(text('a', mark('strong')), text('b', mark('strong')))),
      )
    })

    it('keeps a mark on a block', () => {
      expectNative(
        doc(
          {
            type: 'paragraph',
            marks: [mark('alignment', { align: 'center' })],
            content: [text('mid')],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            marks: [mark('indentation', { level: 1 })],
            content: [text('h')],
          },
        ),
      )
    })
  })

  describe('block attrs', () => {
    it('keeps localId on every block it can sit on, in native Markdown', () => {
      const id = (n: string) => ({ localId: n })
      expectNative(
        doc(
          { type: 'paragraph', attrs: id('p1'), content: [text('para')] },
          { type: 'heading', attrs: { level: 3, ...id('h1') }, content: [text('head')] },
          {
            type: 'bulletList',
            attrs: id('l1'),
            content: [
              {
                type: 'listItem',
                attrs: id('i1'),
                content: [
                  { type: 'paragraph', attrs: id('p2'), content: [text('one')] },
                  {
                    type: 'orderedList',
                    attrs: { order: 1, ...id('l2') },
                    content: [
                      {
                        type: 'listItem',
                        attrs: id('i2'),
                        content: [{ type: 'paragraph', attrs: id('p3'), content: [text('deep')] }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'listItem',
                attrs: id('i3'),
                content: [{ type: 'paragraph', content: [text('two')] }],
              },
            ],
          },
          {
            type: 'blockquote',
            attrs: id('b1'),
            content: [{ type: 'paragraph', attrs: id('p4'), content: [text('quote')] }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'bulletList', attrs: id('nested'), content: [li(para(text('in')))] },
                ],
              },
            ],
          },
          { type: 'paragraph', attrs: id('empty') },
          { type: 'paragraph', attrs: {}, content: [text('empty attrs')] },
          { type: 'paragraph' },
        ),
      )
    })

    it('keeps a localId on a first item that holds an empty paragraph', () => {
      expectNative(
        doc(
          ul(
            {
              type: 'listItem',
              attrs: { localId: 'i' },
              content: [{ type: 'paragraph', attrs: { localId: 'p' } }],
            },
            li(para()),
          ),
        ),
      )
    })

    it('puts a block that cannot hold a note in a fence', () => {
      expectLossless(
        doc(
          node(
            'bulletList',
            { localId: 'l' },
            node('listItem', { localId: 'i' }, node('codeBlock', undefined, text('x'))),
          ),
        ),
      )
    })

    it('keeps a code block localId', () => {
      expectLossless(doc(node('codeBlock', { language: 'ts', localId: 'c' }, text('x'))))
      expectLossless(doc(node('codeBlock', {}, text('x'))))
    })

    it('keeps an ordered list that has no order', () => {
      expectLossless(doc(node('orderedList', undefined, li(para(text('x'))))))
    })

    it('keeps attrs that Jira adds and Markdown cannot show', () => {
      expectNative(
        doc(
          node(
            'table',
            { isNumberColumnEnabled: true, layout: 'wide', localId: 't' },
            node(
              'tableRow',
              { localId: 'r' },
              node(
                'tableHeader',
                { colspan: 1, rowspan: 1, colwidth: [120], background: '#eee', localId: 'c1' },
                { type: 'paragraph', attrs: { localId: 'p' }, content: [text('h')] },
              ),
            ),
            node('tableRow', undefined, node('tableCell', { localId: 'c2' }, para(text('v')))),
          ),
        ),
      )
    })
  })

  describe('line breaks', () => {
    it('writes a break between text as a backslash newline', () => {
      expect(expectNative(doc(para(text('a'), { type: 'hardBreak' }, text('b'))))).toBe('a\\\nb')
    })

    it.each([
      ['at the end', para(text('a'), { type: 'hardBreak' })],
      ['at the start', para({ type: 'hardBreak' }, text('a'))],
      ['doubled', para(text('a'), { type: 'hardBreak' }, { type: 'hardBreak' }, text('b'))],
      ['beside a space', para(text('a '), { type: 'hardBreak' }, text(' b'))],
      [
        'after a card',
        para(node('inlineCard', { url: 'https://x.test/a' }), { type: 'hardBreak' }, text('b')),
      ],
      ['in a heading', h(2, text('a'), { type: 'hardBreak' }, text('b'))],
    ])('keeps a break %s in plain Markdown', (_name, block) => {
      expectNative(doc(block))
    })

    it.each([
      ['alone', para({ type: 'hardBreak' })],
      ['with attrs', para(text('a'), node('hardBreak', { text: '\n' }), text('b'))],
    ])('keeps a break %s', (_name, block) => {
      expectLossless(doc(block))
    })

    it('keeps a break in a table cell', () => {
      expectNative(
        doc(
          node(
            'table',
            undefined,
            node(
              'tableRow',
              undefined,
              node('tableHeader', {}, para(text('a'), { type: 'hardBreak' }, text('b'))),
            ),
          ),
        ),
      )
    })
  })

  describe('odd text', () => {
    const odd = [
      '# not a heading',
      '## also not',
      '#hashtag',
      '* star',
      '*emphasis*',
      '**strong**',
      '***both***',
      '_under_',
      'snake_case_name',
      '__init__',
      '- dash',
      '+ plus',
      '1. one',
      '12) twelve',
      '> quote',
      '>',
      '| a | b |',
      'a | b',
      '---',
      '***',
      '===',
      '`code`',
      '``a`b``',
      '```fence',
      '[link](http://x.test)',
      '[ref]: http://x.test',
      '![img](http://x.test/i.png)',
      '<b>html</b>',
      '<!-- comment -->',
      '<!--adf paragraph {"attrs":{"localId":"fake"}}-->',
      '<adf-node data=\'{"type":"rule"}\'>x</adf-node>',
      '</adf-node>',
      '&amp; &lt; &#35;',
      'a & b',
      '~~strike~~',
      '~tilde~',
      '\\',
      'ends with a backslash\\',
      '\\* already escaped',
      '    four spaces',
      '\ttab first',
      'a\ttab',
      'two  spaces',
      'https://example.com/a_b_c?x=1',
      'http://example.com',
      'www.example.com',
      'mail me@example.com',
      '@mention',
      '$5 and $6',
      ':smile:',
      '{braces}',
      ' leading nbsp',
      'trailing nbsp ',
      'café \u{1F600} 中文',
      '1.5 is not a list',
      '-1 degrees',
      '(parens) [brackets] {braces}',
      '"quotes" \'single\'',
    ]

    it.each(odd)('keeps %j in a paragraph, in plain Markdown', (value) => {
      expectNative(doc(para(text(value))))
    })

    it.each(odd)('keeps %j after a break', (value) => {
      expectLossless(doc(para(text('first'), { type: 'hardBreak' }, text(value))))
    })

    it.each(odd)('keeps %j in a heading', (value) => {
      expectLossless(doc(h(2, text(value))))
    })

    it.each(odd)('keeps %j in a list item and a quote', (value) => {
      expectLossless(
        doc(
          ul(li(para(text(value)))),
          ol(1, li(para(text(value)))),
          node('blockquote', undefined, para(text(value))),
        ),
      )
    })

    it.each(odd)('keeps %j in a table cell', (value) => {
      expectLossless(
        doc(
          node(
            'table',
            undefined,
            node(
              'tableRow',
              undefined,
              node('tableHeader', {}, para(text(value))),
              node('tableHeader', {}, para(text('b'))),
            ),
            node(
              'tableRow',
              undefined,
              node('tableCell', {}, para(text(value))),
              node('tableCell', {}, para(text(value, mark('strong')))),
            ),
          ),
        ),
      )
    })

    it.each(odd)('keeps %j in link text, a code mark and a code block', (value) => {
      expectLossless(
        doc(
          para(text(value, link('https://x.test/a b(c)', 'say "hi"'))),
          para(text(value, mark('code'))),
          para(text(value, mark('strong'), mark('em'))),
          node('codeBlock', undefined, text(value)),
        ),
      )
    })

    it('keeps a pipe in a table cell, in a code span and in a link title', () => {
      expectNative(
        doc(
          node(
            'table',
            undefined,
            node(
              'tableRow',
              undefined,
              node(
                'tableHeader',
                {},
                para(
                  text('a|b', mark('code')),
                  text(' '),
                  text('c', link('https://x.test', 'p|q')),
                ),
              ),
            ),
          ),
        ),
      )
    })

    it('keeps a code block with backticks and fence-like lines', () => {
      expectNative(
        doc(
          node('codeBlock', undefined, text('```\nnot the end\n```` still\n   ```\n')),
          node('codeBlock', { language: 'md' }, text('# heading\n- item\n\n\n')),
          node('codeBlock', undefined, text('  indented\n\ttabbed')),
        ),
      )
    })

    it('keeps URL-like text in a link and as plain text', () => {
      expectNative(
        doc(
          para(
            text('https://example.com', link('https://example.com')),
            text(' and https://example.com/plain and '),
            text('www.example.com', link('http://www.example.com')),
          ),
        ),
      )
    })
  })

  describe('whitespace', () => {
    it.each([
      ['leading', ' lead'],
      ['trailing', 'trail '],
      ['both', '  both  '],
      ['only', ' '],
      ['a tab', '\ttab\t'],
      ['non-breaking', ' x '],
    ])('keeps %s whitespace around a paragraph', (_name, value) => {
      expectNative(
        doc(para(text(value)), para(node('inlineCard', { url: 'https://x.test/a' }), text(value))),
      )
    })

    it('keeps trailing space in list items, headings and cells', () => {
      expectNative(
        doc(
          ul(li(para(text('Coaching ')))),
          h(2, text(' Title ')),
          node(
            'table',
            undefined,
            node('tableRow', undefined, node('tableHeader', {}, para(text(' a ')))),
          ),
        ),
      )
    })

    it('keeps a text node of only spaces between other nodes', () => {
      expectNative(
        doc(
          para(
            text('a'),
            node('inlineCard', { url: 'https://x.test/a' }),
            text(' '),
            node('inlineCard', { url: 'https://x.test/b' }),
          ),
        ),
      )
    })
  })
})

describe('adfToMarkdown on generated text', () => {
  // A seeded generator, so a failure repeats.
  function random(seed: number) {
    let state = seed
    return (limit: number) => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return Math.floor((state / 4294967296) * limit)
    }
  }
  const pieces = [
    'a',
    'b',
    'Z9',
    ' ',
    '  ',
    '*',
    '_',
    '`',
    '[',
    ']',
    '(',
    ')',
    '#',
    '>',
    '|',
    '\\',
    '<',
    '&',
    '~',
    '-',
    '+',
    '1.',
    '\n',
    '\u00a0',
    'http://x.y',
    '@',
    '!',
  ]
  const marks = [
    mark('strong'),
    mark('em'),
    mark('code'),
    mark('strike'),
    mark('underline'),
    link('https://x.test/a b'),
    mark('textColor', { color: '#f00' }),
  ]

  function inline(pick: (limit: number) => number): AdfNode[] {
    const nodes: AdfNode[] = []
    for (let n = pick(5) + 1; n > 0; n--) {
      if (pick(8) === 0) {
        nodes.push({ type: 'hardBreak' })
        continue
      }
      const value = Array.from({ length: pick(4) + 1 }, () => pieces[pick(pieces.length)]).join('')
      const own = marks.filter(() => pick(4) === 0)
      nodes.push(text(value, ...own))
    }
    return nodes
  }

  it('keeps 400 random documents identical', () => {
    const pick = random(42)
    for (let n = 0; n < 400; n++) {
      const content = inline(pick)
      const holder =
        [
          para(...content),
          h(1 + pick(6), ...content),
          ul(li(para(...content))),
          node('blockquote', undefined, para(...content)),
          node(
            'table',
            undefined,
            node('tableRow', undefined, node('tableHeader', {}, para(...content))),
          ),
        ][pick(5)] ?? para()
      const adf = doc(para(text('before')), holder, para(text('after')))
      expect(roundTrip(adf), JSON.stringify(adf)).toStrictEqual(adf)
    }
  })
})

describe('markdownToAdf', () => {
  it('returns a version 1 doc', () => {
    expect(markdownToAdf('')).toStrictEqual({ version: 1, type: 'doc', content: [] })
    expect(markdownToAdf('x')).toMatchObject({ version: 1, type: 'doc' })
  })

  it('reads every supported node', () => {
    const adf = markdownToAdf(
      [
        '# Title',
        '',
        'A **bold**, _italic_, `code`, ~~strike~~ and [link](https://x.test "T") with a<br>break.',
        '',
        '1. one',
        '2. two',
        '   - nested',
        '',
        'Between.',
        '',
        '5. five',
        '',
        '> quote',
        '',
        '---',
        '',
        '```ts',
        'let a',
        '```',
        '',
        '| H1 | H2 |',
        '| --- | --- |',
        '| a | b |',
        '',
        '<https://x.test/card>',
      ].join('\n'),
    )
    expect(adf.content).toStrictEqual([
      h(1, text('Title')),
      para(
        text('A '),
        text('bold', mark('strong')),
        text(', '),
        text('italic', mark('em')),
        text(', '),
        text('code', mark('code')),
        text(', '),
        text('strike', mark('strike')),
        text(' and '),
        text('link', link('https://x.test', 'T')),
        text(' with a'),
        { type: 'hardBreak' },
        text('break.'),
      ),
      ol(1, li(para(text('one'))), li(para(text('two')), ul(li(para(text('nested')))))),
      para(text('Between.')),
      ol(5, li(para(text('five')))),
      node('blockquote', undefined, para(text('quote'))),
      node('rule'),
      node('codeBlock', { language: 'ts' }, text('let a')),
      node(
        'table',
        undefined,
        node(
          'tableRow',
          undefined,
          node('tableHeader', {}, para(text('H1'))),
          node('tableHeader', {}, para(text('H2'))),
        ),
        node(
          'tableRow',
          undefined,
          node('tableCell', {}, para(text('a'))),
          node('tableCell', {}, para(text('b'))),
        ),
      ),
      para(node('inlineCard', { url: 'https://x.test/card' })),
    ])
  })

  it('turns a bare URL into a link and an image into a link', () => {
    expect(
      markdownToAdf('see https://x.test/a and ![alt](https://x.test/i.png)').content,
    ).toStrictEqual([
      para(
        text('see '),
        text('https://x.test/a', link('https://x.test/a')),
        text(' and '),
        text('alt', link('https://x.test/i.png')),
      ),
    ])
  })

  it('keeps a task box as text', () => {
    expect(markdownToAdf('- [ ] todo\n- [x] done').content).toStrictEqual([
      ul(li(para(text('[ ] todo'))), li(para(text('[x] done')))),
    ])
  })

  it('reads raw HTML it does not know as text', () => {
    expect(markdownToAdf('a <span>b</span>\n\n<div>c</div>').content).toStrictEqual([
      para(text('a <span>b</span>')),
      para(text('<div>c</div>')),
    ])
  })

  it('reads an adf fence as the node it holds, and a broken one as code', () => {
    const panel = node('panel', { panelType: 'info' }, para(text('x')))
    expect(markdownToAdf('```adf\n' + JSON.stringify(panel) + '\n```').content).toStrictEqual([
      panel,
    ])
    expect(markdownToAdf('```adf\nnot json\n```').content).toStrictEqual([
      node('codeBlock', { language: 'adf' }, text('not json')),
    ])
    expect(markdownToAdf('```adf\n{"nope":1}\n```').content).toStrictEqual([
      node('codeBlock', { language: 'adf' }, text('{"nope":1}')),
    ])
  })

  it('drops a note it cannot read and one that names no node', () => {
    expect(
      markdownToAdf('a <!--adf paragraph nope--> b <!--adf heading {"attrs":{"x":1}}-->').content,
    ).toStrictEqual([para(text('a  b'))])
  })

  describe('notes, tags and fences that do not read', () => {
    it.each([
      ['marks that are not a list', '{"marks":5}'],
      ['marks that are not marks', '{"marks":[{"nope":1}]}'],
      ['a head that is not a string', '{"head":5}'],
      ['a tail that is not a string', '{"tail":{"a":1}}'],
      ['attrs that are not a record', '{"attrs":"x"}'],
      ['a headerless that is not true', '{"headerless":false}'],
      ['JSON that is not an object', '[1]'],
      ['text that is not JSON', 'nope'],
    ])('drops a note with %s, and the space before it', (_name, patch) => {
      expect(markdownToAdf(`x <!--adf paragraph ${patch}-->`).content).toStrictEqual([
        para(text('x')),
      ])
    })

    it('drops a bad note on a list item and on a note-only line', () => {
      expect(markdownToAdf('- x <!--adf listItem {"head":["a"]}-->').content).toStrictEqual([
        ul(li(para(text('x')))),
      ])
      expect(markdownToAdf('<!--adf paragraph {"marks":5}-->').content).toStrictEqual([])
    })

    it('still applies a note that reads', () => {
      expect(
        markdownToAdf('x <!--adf paragraph {"head":" ","tail":"  ","attrs":{"localId":"a"}}-->')
          .content,
      ).toStrictEqual([{ type: 'paragraph', attrs: { localId: 'a' }, content: [text(' x  ')] }])
    })

    it.each(['table', 'paragraph', 'bulletList', 'panel', 'mediaSingle'])(
      'reads a %s in an adf-node tag as text, so a block cannot land in a paragraph',
      (type) => {
        const tag = `<adf-node data='{"type":"${type}"}'>x</adf-node>`
        expect(markdownToAdf(`a ${tag} b`).content).toStrictEqual([para(text(`a ${tag} b`))])
      },
    )

    it('reads an inline node, or one of a type it has never seen, in an adf-node tag', () => {
      expect(
        markdownToAdf(`a <adf-node data='{"type":"hologram"}'>x</adf-node> b`).content,
      ).toStrictEqual([para(text('a '), node('hologram'), text(' b'))])
      expect(
        markdownToAdf(`<adf-node data='{"type":"mention"}'>x</adf-node>`).content,
      ).toStrictEqual([para(node('mention'))])
    })

    it.each(['text', 'mention', 'hardBreak', 'inlineCard'])(
      'reads an inline %s in an adf fence as code, so an inline node cannot land in a document',
      (type) => {
        const json = JSON.stringify({ type })
        expect(markdownToAdf('```adf\n' + json + '\n```').content).toStrictEqual([
          node('codeBlock', { language: 'adf' }, text(json)),
        ])
      },
    )

    it('reads a block, or a type it has never seen, in an adf fence as that node', () => {
      expect(markdownToAdf('```adf\n{"type":"nope"}\n```').content).toStrictEqual([node('nope')])
      expect(markdownToAdf('```adf\n{"type":"table"}\n```').content).toStrictEqual([node('table')])
    })
  })

  describe('nesting', () => {
    function thrown(run: () => unknown): unknown {
      try {
        run()
      } catch (error) {
        return error
      }
      return undefined
    }

    it('refuses Markdown nested past the stack with validation_failed', () => {
      const error = thrown(() => markdownToAdf(`${'>'.repeat(5000)} x`))
      expect(error).toBeInstanceOf(JiraMgrError)
      expect(error).toMatchObject({ code: 'validation_failed' })
    })

    it('refuses ADF nested past the stack with validation_failed', () => {
      let deep: AdfNode = para(text('x'))
      for (let level = 0; level < 20000; level++) deep = node('blockquote', undefined, deep)
      const error = thrown(() => adfToMarkdown(doc(deep)))
      expect(error).toBeInstanceOf(JiraMgrError)
      expect(error).toMatchObject({ code: 'validation_failed' })
    })

    it('converts ordinary nesting', () => {
      let deep: AdfNode = para(text('x'))
      for (let level = 0; level < 40; level++) deep = node('blockquote', undefined, deep)
      expectNative(doc(deep))
    })
  })

  const markdownSamples = [
    '# Heading\n\nParagraph with **bold**, _em_ and `code`.\n\n- a\n- b\n  - c\n\n1. one\n2. two\n\n> quote\n\n---\n\n```ts\nx\n```',
    '| a | b |\n| --- | --- |\n| 1 | 2 |\n| **x** | `y` |',
    'Line one\\\nline two\n\n<https://x.test/a> and [l](https://x.test/b "t")',
    '- a\n\n  second para\n- b\n\n<!-- -->\n\n- c',
    '3. three\n4. four\n\n10. ten',
    'Text with \\* stars \\_ and \\# hash, a<br>break.',
    '## Title with `code` and *emphasis*',
    '> a\n>\n> - b\n> - c\n\ntail',
    '    indented code\n\nafter',
    '~~gone~~ <u>under</u> text',
  ]

  it.each(markdownSamples)('is stable from Markdown to ADF to Markdown: %j', (markdown) => {
    const once = adfToMarkdown(markdownToAdf(markdown))
    expect(adfToMarkdown(markdownToAdf(once))).toBe(once)
    expect(markdownToAdf(once)).toStrictEqual(markdownToAdf(markdown))
    expect(once).not.toMatch(/```adf|<adf-node/)
  })
})

describe('invalid ADF', () => {
  it.each([
    ['null', null],
    ['a string', 'text'],
    ['an array', []],
    ['no version', { type: 'doc', content: [] }],
    ['version 2', { version: 2, type: 'doc', content: [] }],
    ['the wrong type', { version: 1, type: 'paragraph', content: [] }],
    ['no content', { version: 1, type: 'doc' }],
    ['a node with no type', { version: 1, type: 'doc', content: [{ content: [] }] }],
    [
      'a nested node with no type',
      { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'x' }] }] },
    ],
    [
      'text that is not a string',
      {
        version: 1,
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 5 }] }],
      },
    ],
    [
      'marks that are not a list',
      { version: 1, type: 'doc', content: [{ type: 'text', marks: 'strong' }] },
    ],
    ['a top-level text node', doc(text('loose'))],
    ['a top-level mention', doc(para(), node('mention', { id: '1' }))],
  ])('throws validation_failed for %s', (_name, input) => {
    expect.assertions(2)
    try {
      adfToMarkdown(input)
    } catch (error) {
      expect(error).toBeInstanceOf(JiraMgrError)
      expect(error).toMatchObject({ code: 'validation_failed' })
    }
  })
})
