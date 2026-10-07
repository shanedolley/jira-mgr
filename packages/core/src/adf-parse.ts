import { Lexer, type Token, type Tokens } from 'marked'

import {
  adfNodeSchema,
  FENCE,
  isBlockNode,
  isInlineNode,
  NODE_TAG,
  NOTE,
  patchSchema,
  SEPARATOR,
  same,
  type AdfMark,
  type AdfNode,
  type Patch,
} from './adf-schema.js'

/** A note found in the Markdown, waiting for the node it names. */
interface Pending {
  type: string
  patch: Patch
}

interface Built {
  node: AdfNode
  pending: Pending[]
}

interface Item {
  node: AdfNode
  /** Adjacent text with equal marks is one run in Markdown, so it merges. */
  merge: boolean
}

const MARKS: Record<string, string> = { strong: 'strong', em: 'em', del: 'strike' }

function parseNote(text: string): Pending | undefined {
  const match = NOTE.exec(text.trim())
  if (!match) return undefined
  try {
    const patch = patchSchema.safeParse(JSON.parse(match[2] ?? ''))
    return patch.success ? { type: match[1] ?? '', patch: patch.data } : undefined
  } catch {
    return undefined
  }
}

function isPlain(node: AdfNode | undefined): node is AdfNode & { text: string } {
  return node?.type === 'text' && node.marks === undefined && node.text !== undefined
}

function applyPatch(node: AdfNode, patch: Patch): void {
  if (patch.attrs === null) delete node.attrs
  else if (patch.attrs) node.attrs = { ...node.attrs, ...patch.attrs }
  if (patch.marks) node.marks = patch.marks
  const content = (node.content ??= [])
  if (patch.head) {
    const first = content[0]
    if (isPlain(first)) first.text = patch.head + first.text
    else content.unshift(textNode(patch.head, []))
  }
  if (patch.tail) {
    const last = content[content.length - 1]
    if (isPlain(last)) last.text += patch.tail
    else content.push(textNode(patch.tail, []))
  }
  if (content.length === 0) delete node.content
}

/** Applies the first note of the node's own type and hands the rest up to its ancestors. */
function finish(node: AdfNode, pending: Pending[]): Built {
  const rest: Pending[] = []
  let applied = false
  for (const entry of pending) {
    if (!applied && entry.type === node.type) {
      applyPatch(node, entry.patch)
      applied = true
    } else rest.push(entry)
  }
  return { node, pending: rest }
}

/** A container takes the notes of its first child: the note sits at the end of its first line. */
function adopt(node: AdfNode, children: Built[]): Built {
  if (children.length > 0) node.content = children.map((child) => child.node)
  return finish(node, children[0]?.pending ?? [])
}

function textNode(text: string, marks: AdfMark[]): AdfNode {
  return marks.length > 0 ? { type: 'text', text, marks: [...marks] } : { type: 'text', text }
}

function nodeFromTag(tag: string): AdfNode | undefined {
  const match = /data='([^']*)'/.exec(tag)
  try {
    const parsed = adfNodeSchema.safeParse(JSON.parse(match?.[1] ?? ''))
    return parsed.success && isInlineNode(parsed.data) ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function inline(tokens: Token[]): { content: AdfNode[]; pending: Pending[] } {
  const items: Item[] = []
  const pending: Pending[] = []
  let skipping = false
  // An object, because the closure below sets it and TypeScript cannot see that through a `let`.
  const seen = { note: false }

  const text = (value: string, marks: AdfMark[]) => {
    if (value) items.push({ node: textNode(value, marks), merge: true })
  }

  const walk = (list: Token[], base: AdfMark[]) => {
    let marks = base
    for (const token of list) {
      if (skipping) {
        if (token.type === 'html' && token.raw === `</${NODE_TAG}>`) skipping = false
        continue
      }
      switch (token.type) {
        case 'text':
        case 'escape': {
          const children = (token as Tokens.Text).tokens
          // `raw` keeps entities such as `&#35;` as written; escapes carry their own `text`.
          if (children) walk(children, marks)
          else text(token.type === 'text' ? token.raw : (token as Tokens.Escape).text, marks)
          break
        }
        case 'codespan':
          text((token as Tokens.Codespan).text, [...marks, { type: 'code' }])
          break
        case 'strong':
        case 'em':
        case 'del':
          walk((token as Tokens.Strong).tokens, [
            ...marks,
            { type: MARKS[token.type] ?? token.type },
          ])
          break
        case 'link': {
          const link = token as Tokens.Link
          if (link.raw.startsWith('<') && marks.length === 0) {
            items.push({ node: { type: 'inlineCard', attrs: { url: link.href } }, merge: false })
            break
          }
          const attrs = link.title ? { href: link.href, title: link.title } : { href: link.href }
          walk(link.tokens, [...marks, { type: 'link', attrs }])
          break
        }
        case 'image': {
          const image = token as Tokens.Image
          text(image.text || image.href, [...marks, { type: 'link', attrs: { href: image.href } }])
          break
        }
        case 'br':
          items.push({ node: { type: 'hardBreak' }, merge: false })
          break
        case 'html': {
          const raw = token.raw
          const found = parseNote(raw)
          if (NOTE.test(raw.trim())) seen.note = true
          if (found) pending.push(found)
          else if (/^<br\s*\/?>$/i.test(raw))
            items.push({ node: { type: 'hardBreak' }, merge: false })
          else if (raw === '<u>') marks = [...marks, { type: 'underline' }]
          else if (raw === '</u>') {
            const at = marks.map((mark) => mark.type).lastIndexOf('underline')
            if (at >= 0) marks = marks.filter((_, index) => index !== at)
          } else if (raw.startsWith(`<${NODE_TAG} `)) {
            const node = nodeFromTag(raw)
            if (node) {
              items.push({ node, merge: false })
              skipping = true
            } else text(raw, marks)
          } else if (!raw.startsWith('<!--')) text(raw, marks)
          break
        }
        default:
          text(token.raw, marks)
      }
    }
  }
  walk(tokens, [])

  const content: AdfNode[] = []
  let previous: Item | undefined
  for (const item of items) {
    const last = content[content.length - 1]
    if (
      previous?.merge &&
      item.merge &&
      last?.text !== undefined &&
      same(last.marks ?? [], item.node.marks ?? [])
    ) {
      last.text += item.node.text ?? ''
    } else content.push(item.node)
    previous = item
  }
  // The writer puts one space before the notes, and a paragraph never ends in whitespace otherwise.
  const last = content[content.length - 1]
  if (seen.note && last?.type === 'text' && last.text !== undefined) {
    last.text = last.text.trimEnd()
    if (!last.text) content.pop()
  }
  return { content, pending }
}

function textBlock(type: string, tokens: Token[], attrs?: Record<string, unknown>): Built {
  const { content, pending } = inline(tokens)
  const node: AdfNode = { type }
  if (attrs) node.attrs = attrs
  if (content.length > 0) node.content = content
  return finish(node, pending)
}

function cell(source: Tokens.TableCell, type: 'tableHeader' | 'tableCell'): Built {
  return adopt({ type, attrs: {} }, [textBlock('paragraph', source.tokens)])
}

function table(token: Tokens.Table): Built {
  const head = adopt(
    { type: 'tableRow' },
    token.header.map((c) => cell(c, 'tableHeader')),
  )
  const body = token.rows.map((row) =>
    adopt(
      { type: 'tableRow' },
      row.map((c) => cell(c, 'tableCell')),
    ),
  )
  const headerless = head.pending.some((entry) => entry.type === 'table' && entry.patch.headerless)
  const node: AdfNode = {
    type: 'table',
    content: (headerless ? body : [head, ...body]).map((row) => row.node),
  }
  return finish(node, head.pending)
}

function list(token: Tokens.List): Built {
  const items = token.items.map((item) => {
    const kids = blocks(item.tokens)
    const box = item.tokens[0]
    if (box?.type === 'checkbox') {
      const first = kids[0]
      const lead = first?.node.content?.[0]
      if (isPlain(lead)) lead.text = box.raw + lead.text
    }
    return adopt({ type: 'listItem' }, kids)
  })
  const ordered = typeof token.start === 'number'
  const node: AdfNode = ordered
    ? { type: 'orderedList', attrs: { order: token.start } }
    : { type: 'bulletList' }
  return adopt(node, items)
}

function html(token: Tokens.HTML): Built[] {
  const text = token.text.trim()
  if (text === SEPARATOR || /^<!--(?!adf )[\s\S]*-->$/.test(text)) return []
  const pending: Pending[] = []
  const rest = text.replace(/<!--adf [\s\S]*?-->/g, (match) => {
    const found = parseNote(match)
    if (found) pending.push(found)
    // A note that does not read is dropped, as it is inline.
    return ''
  })
  if (rest.trim())
    return [textBlock('paragraph', [{ type: 'text', raw: rest.trim(), text: rest.trim() }])]
  // A line of notes alone is an empty paragraph: Markdown has no other way to write one.
  return pending.some((entry) => entry.type === 'paragraph')
    ? [finish({ type: 'paragraph' }, pending)]
    : []
}

function block(token: Token): Built[] {
  switch (token.type) {
    case 'paragraph':
    case 'text':
      return [textBlock('paragraph', (token as Tokens.Paragraph).tokens)]
    case 'heading': {
      const heading = token as Tokens.Heading
      return [textBlock('heading', heading.tokens, { level: heading.depth })]
    }
    case 'code': {
      const code = token as Tokens.Code
      if (code.lang === FENCE) {
        try {
          const parsed = adfNodeSchema.safeParse(JSON.parse(code.text))
          if (parsed.success && isBlockNode(parsed.data)) {
            return [{ node: parsed.data, pending: [] }]
          }
        } catch {
          // Not JSON: an ordinary code block that happens to say adf.
        }
      }
      const node: AdfNode = { type: 'codeBlock' }
      if (code.lang) node.attrs = { language: code.lang }
      if (code.text) node.content = [{ type: 'text', text: code.text }]
      return [{ node, pending: [] }]
    }
    case 'hr':
      return [{ node: { type: 'rule' }, pending: [] }]
    case 'blockquote':
      return [adopt({ type: 'blockquote' }, blocks((token as Tokens.Blockquote).tokens))]
    case 'list':
      return [list(token as Tokens.List)]
    case 'table':
      return [table(token as Tokens.Table)]
    case 'html':
      return html(token as Tokens.HTML)
    case 'space':
    case 'def':
    case 'checkbox':
      return []
    default:
      return [textBlock('paragraph', [{ type: 'text', raw: token.raw, text: token.raw.trim() }])]
  }
}

function blocks(tokens: Token[]): Built[] {
  return tokens.flatMap(block)
}

/** The block nodes of a Markdown document. Never fails: any text is Markdown. */
export function parseMarkdown(markdown: string): AdfNode[] {
  return blocks(new Lexer({ gfm: true }).lex(markdown)).map((built) => built.node)
}
