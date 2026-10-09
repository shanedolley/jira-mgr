import type { AdfNode } from '@jira-mgr/core/adf'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'

import { externalUrl } from '../../shared/links'
import { inlineShape } from './editor/readOnly'

/** A mention, date, status, emoji or card inside a paragraph: text only, kept as the original ADF. */
export function ReadOnlyInline({ node }: ReactNodeViewProps) {
  const shape = inlineShape(node.attrs.node as AdfNode)
  const safe = shape.kind === 'link' && shape.url !== undefined ? externalUrl(shape.url) : null
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      title={shape.title}
      className={
        shape.kind === 'mention' ? 'rounded bg-selected px-1 text-accent' : 'rounded bg-hover px-1'
      }
    >
      {safe !== null ? <a href={safe}>{shape.text}</a> : shape.text}
    </NodeViewWrapper>
  )
}
