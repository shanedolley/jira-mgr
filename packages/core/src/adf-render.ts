import { parseMarkdown } from './adf-parse.js'
import {
  FENCE,
  NODE_TAG,
  SEPARATOR,
  note,
  safeJson,
  same,
  type AdfMark,
  type AdfNode,
  type Patch,
} from './adf-schema.js'

/** Thrown when a node has no Markdown form that reads back to the same node. */
class NotNative extends Error {}

/**
 * `lines` is the Markdown. `notes` are comments for this node and its ancestors that wait for a
 * line to sit on, and `host` is the line they go on: the last line of the first text block.
 * `host` is null where no comment fits, such as a code fence.
 */
interface Out {
  lines: string[]
  notes: string[]
  host: number | null
}

/** `flow` is a paragraph, `heading` and `cell` cannot hold a line break. */
type Ctx = 'flow' | 'heading' | 'cell'

const OWN_KEYS = new Set(['type', 'attrs', 'content', 'marks', 'text'])
/** The attrs the Markdown form of a node spells out itself, so a note never repeats them. */
const CARRIED: Record<string, string[]> = {
  heading: ['level'],
  orderedList: ['order'],
  codeBlock: ['language'],
}
const WRAP: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['_', '_'],
  strike: ['~~', '~~'],
  underline: ['<u>', '</u>'],
}
const NATIVE_MARKS = new Set(['code', 'link', ...Object.keys(WRAP)])
const AUTOLINK = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*$/

function ownKeysOnly(node: object, allowed: Iterable<string> = OWN_KEYS): boolean {
  const keys = new Set(allowed)
  return Object.keys(node).every((key) => keys.has(key))
}

/** The patch for what Markdown cannot say about a node: attrs outside `CARRIED`, and marks. */
function patchOf(node: AdfNode, derivesAttrs: boolean, edges: Patch = {}): Patch | undefined {
  if (!ownKeysOnly(node)) throw new NotNative()
  const patch: Patch = { ...edges }
  // The parser gives every table cell `attrs: {}`, so a cell with none needs a note.
  const derives = derivesAttrs || /^table(Cell|Header)$/.test(node.type)
  if (node.attrs) {
    const carried = CARRIED[node.type] ?? []
    const extra = Object.fromEntries(
      Object.entries(node.attrs).filter(([k]) => !carried.includes(k)),
    )
    if (!derives || Object.keys(extra).length > 0) patch.attrs = extra
  } else if (/^table(Cell|Header)$/.test(node.type)) patch.attrs = null
  if (node.marks) patch.marks = node.marks
  return Object.keys(patch).length > 0 ? patch : undefined
}

function noteOf(node: AdfNode, derivesAttrs: boolean, edges?: Patch): string[] {
  const patch = patchOf(node, derivesAttrs, edges)
  return patch ? [note(node.type, patch)] : []
}

const BLANK = /^[^\S\r\n]+/
const TRAILING_BLANK = /[^\S\r\n]+$/

/** Moves the spaces Markdown would drop from the ends of a text block into a patch. */
function trimEdges(nodes: AdfNode[]): { nodes: AdfNode[]; edges: Patch } {
  const kept = [...nodes]
  const edges: Patch = {}
  const plainAt = (index: number) => {
    const node = kept[index]
    return node?.type === 'text' && node.text !== undefined && ownKeysOnly(node, ['type', 'text'])
      ? node
      : undefined
  }
  const first = plainAt(0)
  const head = first?.text && BLANK.exec(first.text)?.[0]
  if (first && head) {
    edges.head = head
    const text = (first.text ?? '').slice(head.length)
    if (text) kept[0] = { ...first, text }
    else kept.shift()
  }
  const last = plainAt(kept.length - 1)
  const tail = last?.text && TRAILING_BLANK.exec(last.text)?.[0]
  if (last && tail) {
    edges.tail = tail
    const text = (last.text ?? '').slice(0, -tail.length)
    if (text) kept[kept.length - 1] = { ...last, text }
    else kept.pop()
  }
  return { nodes: kept, edges }
}

function escapeText(text: string, lineStart: boolean, ctx: Ctx): string {
  let out = text
    .replace(/[\\`*[\]<~]/g, '\\$&')
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
    // Stop GFM from turning bare URLs and addresses into links.
    .replace(/\b(https?|ftp):(?=\/\/)/gi, '$1\\:')
    .replace(/\bwww\./gi, 'www\\.')
    .replace(/(?<=[\w.+-])@/g, '\\@')
  if (lineStart) {
    out = out.replace(/^(\s*)([#>+=-])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2')
  }
  if (ctx === 'heading') out = out.replace(/#$/, '\\#')
  return out
}

function isBreak(node: AdfNode): boolean {
  return node.type === 'hardBreak' && ownKeysOnly(node, ['type'])
}

function isNativeText(node: AdfNode): boolean {
  if (node.type !== 'text' || !node.text || !ownKeysOnly(node, ['type', 'text', 'marks']))
    return false
  if (/[\r\n]/.test(node.text)) return false
  const marks = node.marks ?? []
  if (node.marks && marks.length === 0) return false
  for (const [index, mark] of marks.entries()) {
    if (!NATIVE_MARKS.has(mark.type) || !ownKeysOnly(mark, ['type', 'attrs'])) return false
    if (mark.type === 'code' && index !== marks.length - 1) return false
    if (mark.type === 'link') {
      const attrs = mark.attrs
      if (!attrs || !ownKeysOnly(attrs, ['href', 'title'])) return false
      const { href, title } = attrs
      if (typeof href !== 'string' || !href || /[\r\n]/.test(href)) return false
      if (title !== undefined && (typeof title !== 'string' || /[\r\n]/.test(title))) return false
    } else if (mark.attrs !== undefined) return false
  }
  // Markdown closes a mark at a space, and a code span trims its own padding.
  return marks.at(-1)?.type === 'code' || marks.length === 0 || !/^\s|\s$/.test(node.text)
}

function isNativeCard(node: AdfNode): boolean {
  const url = node.attrs?.url
  return (
    node.type === 'inlineCard' &&
    ownKeysOnly(node) &&
    !node.marks &&
    node.attrs !== undefined &&
    ownKeysOnly(node.attrs, ['url']) &&
    typeof url === 'string' &&
    AUTOLINK.test(url)
  )
}

type Kind = 'text' | 'break' | 'card' | 'generic'
interface Piece {
  node: AdfNode
  kind: Kind
  lineStart: boolean
  /** A break written as a newline. One at an edge of the paragraph, or next to another, is `<br>`. */
  newline: boolean
}

function classify(nodes: AdfNode[], ctx: Ctx): Piece[] {
  const pieces: Piece[] = []
  const newlineAt = (index: number) => {
    const node = nodes[index]
    const before = nodes[index - 1]
    const after = nodes[index + 1]
    return (
      ctx === 'flow' &&
      node !== undefined &&
      isBreak(node) &&
      before !== undefined &&
      after !== undefined &&
      !isBreak(before) &&
      !isBreak(after) &&
      // Markdown would drop a space beside a newline, so a break beside one stays `<br>`.
      !/^[^\S\r\n]/.test(after.text ?? '')
    )
  }
  for (const [index, node] of nodes.entries()) {
    const lineStart = index === 0 || newlineAt(index - 1)
    let kind: Kind = 'generic'
    if (isBreak(node)) kind = 'break'
    else if (isNativeText(node)) kind = 'text'
    else if (isNativeCard(node)) kind = 'card'
    const previous = pieces.at(-1)
    // Markdown reads two text runs with the same marks as one.
    if (
      kind === 'text' &&
      previous?.kind === 'text' &&
      same(previous.node.marks ?? [], node.marks ?? [])
    ) {
      kind = 'generic'
    }
    pieces.push({ node, kind, lineStart, newline: newlineAt(index) })
  }
  return pieces
}

function label(node: AdfNode): string {
  const attrs = node.attrs ?? {}
  const timestamp = Number(attrs.timestamp)
  const date =
    Number.isFinite(timestamp) && attrs.timestamp !== undefined ? new Date(timestamp) : undefined
  const named = [node.text, attrs.text, attrs.shortName, attrs.url].find(
    (v) => typeof v === 'string',
  )
  return (
    named ?? (date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : node.type)
  )
}

function genericInline(node: AdfNode, ctx: Ctx): string {
  const shown = escapeText(label(node), false, ctx).replace(/\s+/g, ' ')
  return `<${NODE_TAG} data='${safeJson(node)}'>${shown}</${NODE_TAG}>`
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const ticks = '`'.repeat(longest + 1)
  const pad = /[^ ]/.test(text) && /^[ `]|[ `]$/.test(text) ? ' ' : ''
  return `${ticks}${pad}${text}${pad}${ticks}`
}

function linkClose(mark: AdfMark): string {
  const { href, title } = mark.attrs as { href: string; title?: string }
  const dest = /[\s()<>\\]/.test(href) ? `<${href.replace(/[<>\\]/g, '\\$&')}>` : href
  const quoted = title === undefined ? '' : ` "${title.replace(/["\\]/g, '\\$&')}"`
  return `](${dest}${quoted})`
}

function leaf(piece: Piece, ctx: Ctx): string {
  const { node } = piece
  switch (piece.kind) {
    case 'text':
      return escapeText(node.text ?? '', piece.lineStart, ctx)
    case 'break':
      return piece.newline ? '\\\n' : '<br>'
    case 'card':
      return `<${String(node.attrs?.url)}>`
    default:
      return genericInline(node, ctx)
  }
}

/** Writes pieces that share their first `depth` marks, wrapping each run of equal marks once. */
function emit(pieces: Piece[], depth: number, ctx: Ctx): string {
  let out = ''
  let index = 0
  while (index < pieces.length) {
    const piece = pieces[index]
    const mark = piece?.kind === 'text' ? piece.node.marks?.[depth] : undefined
    if (!piece || !mark) {
      if (piece) out += leaf(piece, ctx)
      index++
      continue
    }
    if (mark.type === 'code') {
      out += codeSpan(piece.node.text ?? '')
      index++
      continue
    }
    let end = index + 1
    while (end < pieces.length) {
      const next = pieces[end]
      const nextMark = next?.kind === 'text' ? next.node.marks?.[depth] : undefined
      if (!nextMark || nextMark.type === 'code' || !same(nextMark, mark)) break
      end++
    }
    let [open, close] =
      mark.type === 'link' ? ['[', linkClose(mark)] : (WRAP[mark.type] ?? ['', ''])
    // `_` cannot open or close inside a word.
    const next = pieces[end]?.node.text
    if (
      mark.type === 'em' &&
      (/[\p{L}\p{N}]$/u.test(out) || (next && /^[\p{L}\p{N}]/u.test(next)))
    ) {
      open = close = '*'
    }
    out += open + emit(pieces.slice(index, end), depth + 1, ctx) + close
    index = end
  }
  return out
}

function renderInline(nodes: AdfNode[], ctx: Ctx): string {
  return emit(classify(nodes, ctx), 0, ctx)
}

function fence(node: AdfNode): Out {
  return { lines: ['```' + FENCE, JSON.stringify(node), '```'], notes: [], host: null }
}

/** Puts the waiting notes on their host line. */
function place(out: Out): string[] {
  if (out.notes.length === 0) return out.lines
  if (out.host === null) throw new NotNative()
  const lines = [...out.lines]
  const line = lines[out.host] ?? ''
  lines[out.host] = line + (/\S$/.test(line) ? ' ' : '') + out.notes.join('')
  return lines
}

/** Sibling blocks with blank lines between. The first block's waiting notes go on to the caller. */
function renderBlocks(nodes: AdfNode[]): Out {
  const [head, ...rest] = nodes
  if (!head) throw new NotNative()
  const first = renderSafe(head)
  const lines = [...first.lines]
  let previous = head
  for (const node of rest) {
    lines.push('')
    if (previous.type === node.type && node.type.endsWith('List')) lines.push(SEPARATOR, '')
    lines.push(...place(renderSafe(node)))
    previous = node
  }
  return { lines, notes: first.notes, host: first.host }
}

function prefixed(lines: string[], first: string, rest: string): string[] {
  return lines.map((line, index) => {
    const lead = index === 0 ? first : rest
    return line ? lead + line : lead.trimEnd()
  })
}

function paragraph(node: AdfNode): Out {
  if (node.content?.length === 0) throw new NotNative()
  const { nodes, edges } = trimEdges(node.content ?? [])
  const lines = renderInline(nodes, 'flow').split('\n')
  const notes = noteOf(node, false, edges)
  // An empty paragraph is only its note, so it always has one.
  if (!node.content && notes.length === 0) notes.push(note('paragraph', {}))
  return { lines, notes, host: lines.length - 1 }
}

function heading(node: AdfNode): Out {
  const level = node.attrs?.level
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6)
    throw new NotNative()
  if (node.content?.length === 0) throw new NotNative()
  const { nodes, edges } = trimEdges(node.content ?? [])
  const text = renderInline(nodes, 'heading')
  return {
    lines: ['#'.repeat(level) + (text ? ` ${text}` : '')],
    notes: noteOf(node, true, edges),
    host: 0,
  }
}

function codeBlock(node: AdfNode): Out {
  const [text, ...extra] = node.content ?? []
  const language = node.attrs?.language
  if (
    extra.length > 0 ||
    (text && (text.type !== 'text' || text.marks || !ownKeysOnly(text, ['type', 'text'])))
  ) {
    throw new NotNative()
  }
  if (
    language !== undefined &&
    (typeof language !== 'string' || !/^[^\s`]+$/.test(language) || language === FENCE)
  ) {
    throw new NotNative()
  }
  const body = text?.text ?? ''
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const ticks = '`'.repeat(Math.max(3, longest + 1))
  const lines = [`${ticks}${language ?? ''}`, ...(text ? body.split('\n') : []), ticks]
  return { lines, notes: noteOf(node, language !== undefined), host: null }
}

function blockquote(node: AdfNode): Out {
  const inner = renderBlocks(node.content ?? [])
  return {
    lines: prefixed(inner.lines, '> ', '> ').map((line) => (line === '' ? '>' : line)),
    notes: [...inner.notes, ...noteOf(node, false)],
    host: inner.host,
  }
}

function listOut(node: AdfNode): Out {
  const items = node.content ?? []
  const order = node.attrs?.order
  const ordered = node.type === 'orderedList'
  if (items.length === 0) throw new NotNative()
  if (ordered && (typeof order !== 'number' || !Number.isInteger(order) || order < 0))
    throw new NotNative()
  const lines: string[] = []
  let notes: string[] = []
  let host: number | null = null
  for (const [index, item] of items.entries()) {
    if (item.type !== 'listItem') throw new NotNative()
    const inner = renderBlocks(item.content ?? [])
    const itemNotes = [...inner.notes, ...noteOf(item, false)]
    const marker = ordered ? `${String(Number(order) + index)}. ` : '- '
    const own = prefixed(inner.lines, marker, ' '.repeat(marker.length))
    if (index === 0) {
      notes = itemNotes
      host = inner.host
      lines.push(...own)
    } else lines.push(...place({ lines: own, notes: itemNotes, host: inner.host }))
  }
  return { lines, notes: [...notes, ...noteOf(node, ordered)], host }
}

function tableOut(node: AdfNode): Out {
  const rows = node.content ?? []
  const width = rows[0]?.content?.length ?? 0
  const headed = rows[0]?.content?.every((c) => c.type === 'tableHeader') ?? false
  if (width === 0) throw new NotNative()
  const cells = rows.map((row, r) => {
    if (row.type !== 'tableRow' || row.content?.length !== width) throw new NotNative()
    const rowNote = noteOf(row, false)
    return row.content.map((cellNode, c) => {
      const [para, ...extra] = cellNode.content ?? []
      const type = r === 0 && headed ? 'tableHeader' : 'tableCell'
      if (cellNode.type !== type || para?.type !== 'paragraph' || extra.length > 0)
        throw new NotNative()
      if (para.content?.length === 0) throw new NotNative()
      const { nodes, edges } = trimEdges(para.content ?? [])
      const notes = [
        ...noteOf(para, false, edges),
        ...noteOf(cellNode, false),
        ...(c === 0 ? rowNote : []),
      ]
      return { text: renderInline(nodes, 'cell'), notes }
    })
  })
  const tablePatch = patchOf(node, false)
  const head = headed
    ? cells[0]
    : Array.from({ length: width }, () => ({ text: '', notes: [] as string[] }))
  const tableNote = headed
    ? tablePatch && [note('table', tablePatch)]
    : [note('table', { ...tablePatch, headerless: true })]
  if (!head) throw new NotNative()
  head[0]?.notes.push(...(tableNote ?? []))
  const line = (row: { text: string; notes: string[] }[]) =>
    `| ${row
      .map(({ text, notes }) =>
        ((text && notes.length > 0 ? `${text} ` : text) + notes.join('')).replace(/\|/g, '\\|'),
      )
      .join(' | ')} |`
  const body = headed ? cells.slice(1) : cells
  return {
    lines: [line(head), `| ${Array<string>(width).fill('---').join(' | ')} |`, ...body.map(line)],
    notes: [],
    host: null,
  }
}

function renderBlock(node: AdfNode): Out {
  switch (node.type) {
    case 'paragraph':
      return paragraph(node)
    case 'heading':
      return heading(node)
    case 'codeBlock':
      return codeBlock(node)
    case 'rule':
      if (node.content) throw new NotNative()
      return { lines: ['---'], notes: noteOf(node, false), host: null }
    case 'blockquote':
      return blockquote(node)
    case 'bulletList':
    case 'orderedList':
      return listOut(node)
    case 'table':
      return tableOut(node)
    default:
      throw new NotNative()
  }
}

function renderSafe(node: AdfNode): Out {
  try {
    return renderBlock(node)
  } catch (error) {
    if (error instanceof NotNative) return fence(node)
    throw error
  }
}

function join(content: AdfNode[], blocks: string[][]): string {
  const lines: string[] = []
  for (const [index, block] of blocks.entries()) {
    const type = content[index]?.type ?? ''
    if (index > 0) {
      lines.push('')
      if (content[index - 1]?.type === type && type.endsWith('List')) lines.push(SEPARATOR, '')
    }
    lines.push(...block)
  }
  return lines.join('\n')
}

/**
 * The Markdown for a document's blocks. Each block is checked by reading its Markdown back, and one
 * that does not come back identical is written as an `adf` fence instead, so nothing is lost.
 * Blocks stand apart in Markdown, except lists of one kind, which `join` separates.
 */
export function renderBlocksToMarkdown(content: AdfNode[]): string {
  const blocks = content.map((node) => {
    try {
      const lines = place(renderSafe(node))
      if (same(parseMarkdown(lines.join('\n')), [node])) return lines
    } catch (error) {
      if (!(error instanceof NotNative)) throw error
    }
    return fence(node).lines
  })
  return join(content, blocks)
}
