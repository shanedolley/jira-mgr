import type { AdfNode } from '@jira-mgr/core/adf'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'

import { blockLabel, blockText, tableRows } from './editor/readOnly'

/**
 * A block the editor cannot edit: shown as text, never as HTML, and kept as the original ADF.
 * It can be selected, moved and deleted, and says it is read-only to a screen reader.
 */
export function ReadOnlyBlock({ node, selected }: ReactNodeViewProps) {
  const adf = node.attrs.node as AdfNode
  const label = blockLabel(adf)
  return (
    <NodeViewWrapper
      role="group"
      contentEditable={false}
      aria-label={`${label}, read-only. Edit it in Jira.`}
      className={`my-2 rounded-md border border-dashed border-line p-2 ${selected ? 'outline-2 outline-accent' : ''}`}
    >
      <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
        <span>{adf.type === 'table' ? 'Table, read-only' : label}</span>
        {adf.type !== 'table' && (
          <span className="rounded bg-hover px-1 normal-case tracking-normal">Read-only</span>
        )}
      </p>
      {adf.type === 'table' ? (
        <table className="w-full border-collapse text-left">
          <tbody>
            {tableRows(adf).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-line px-2 py-1 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="whitespace-pre-wrap break-words">{blockText(adf)}</p>
      )}
    </NodeViewWrapper>
  )
}
