import type { AdfNode } from '@jira-mgr/core/adf'

const BLOCK_LABELS: Record<string, string> = {
  panel: 'Panel',
  table: 'Table',
  expand: 'Expand',
  nestedExpand: 'Expand',
  mediaGroup: 'Files',
  mediaSingle: 'Image',
  layoutSection: 'Layout',
  taskList: 'Tasks',
  decisionList: 'Decisions',
  extension: 'Jira macro',
  bodiedExtension: 'Jira macro',
  blockCard: 'Link card',
  embedCard: 'Embedded link',
}

/** The name a read-only block shows, and a screen reader says: its kind, or the ADF type for an unknown one. */
export function blockLabel(node: AdfNode): string {
  return BLOCK_LABELS[node.type] ?? node.type
}

/** The inline nodes that carry their text in an attribute rather than in a child. */
function attrText(node: AdfNode): string {
  const { attrs } = node
  const pick = (key: string) => (typeof attrs?.[key] === 'string' ? attrs[key] : '')
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'mention':
      return pick('text')
    case 'emoji':
      return pick('text') || pick('shortName')
    case 'status':
      return pick('text')
    case 'inlineCard':
      return pick('url')
    case 'date':
      return dateText(node)
    default:
      return ''
  }
}

/** A `date` node's day in the user's locale. `timestamp` is milliseconds since the epoch, as a string. */
export function dateText(node: AdfNode): string {
  const stamp = Number(node.attrs?.timestamp)
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleDateString() : ''
}

/** One line of text for each text block inside `node`, in document order. */
function lines(node: AdfNode): string[] {
  if (node.type === 'media' && typeof node.attrs?.url === 'string') return [node.attrs.url]
  if (node.type === 'text' || node.type === 'hardBreak' || node.content === undefined) {
    const text = attrText(node)
    return text === '' ? [] : [text]
  }
  const children = node.content
  // A text block holds inline children; join them into one line.
  if (children.every((child) => child.type === 'text' || isInline(child))) {
    const text = children.map((child) => attrText(child)).join('')
    return text === '' ? [] : text.split('\n')
  }
  return children.flatMap(lines)
}

const INLINE = new Set([
  'mention',
  'emoji',
  'date',
  'status',
  'inlineCard',
  'mediaInline',
  'placeholder',
  'inlineExtension',
  'hardBreak',
])
const isInline = (node: AdfNode) => INLINE.has(node.type)

/** The text of a read-only block, one line for each paragraph, heading or item. */
export function blockText(node: AdfNode): string {
  return lines(node).join('\n')
}

/** A table's cells as rows of plain text. */
export function tableRows(table: AdfNode): string[][] {
  return (table.content ?? [])
    .filter((row) => row.type === 'tableRow')
    .map((row) => (row.content ?? []).map((cell) => blockText(cell).replace(/\n/g, ' ')))
}

export interface InlineShape {
  kind: 'mention' | 'link' | 'text'
  /** What the chip or run shows. */
  text: string
  /** The tooltip, such as a mention's account id. */
  title?: string
  /** For a `link`: the card's URL, which the view checks before it opens. */
  url?: string
}

/** What a read-only inline node shows. */
export function inlineShape(node: AdfNode): InlineShape {
  const attrs = node.attrs ?? {}
  switch (node.type) {
    case 'mention': {
      const name = attrText(node).replace(/^@/, '')
      return {
        kind: 'mention',
        text: `@${name}`,
        ...(typeof attrs.id === 'string' ? { title: attrs.id } : {}),
      }
    }
    case 'inlineCard': {
      const url = attrText(node)
      return url === '' ? { kind: 'text', text: '[inlineCard]' } : { kind: 'link', text: url, url }
    }
    case 'mediaInline':
      return { kind: 'text', text: 'Attachment' }
    case 'emoji':
    case 'date':
    case 'status': {
      const text = attrText(node)
      return { kind: 'text', text: text === '' ? `[${node.type}]` : text }
    }
    default:
      return { kind: 'text', text: `[${node.type}]` }
  }
}
