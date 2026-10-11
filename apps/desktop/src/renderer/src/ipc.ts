import { JiraMgrError } from '@jira-mgr/core'

import type { ArgsOf, Channel, IpcResult, ResultOf } from '../../shared/ipc'

/** The data of an `ok` result, or the core error a failed one carries, rebuilt as a `JiraMgrError`. */
export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  const { code, message, detail, status } = result.error
  throw new JiraMgrError(
    code,
    message,
    detail === undefined && status === undefined ? {} : { details: { detail, status } },
  )
}

/** The HTTP status Jira answered with, from `unwrap`, or `undefined` when it did not answer. */
export function statusOf(error: unknown): number | undefined {
  if (!(error instanceof JiraMgrError)) return undefined
  const { details } = error
  if (typeof details !== 'object' || details === null || !('status' in details)) return undefined
  return typeof details.status === 'number' ? details.status : undefined
}

/** The full message an error left out of its text, from `unwrap`, or `undefined`. */
export function detailOf(error: unknown): string | undefined {
  if (!(error instanceof JiraMgrError)) return undefined
  const { details } = error
  if (typeof details !== 'object' || details === null || !('detail' in details)) return undefined
  return typeof details.detail === 'string' ? details.detail : undefined
}

/** Sends one typed request to the main process. Rejects with a `JiraMgrError` on failure. */
export async function call<C extends Channel>(
  channel: C,
  ...args: ArgsOf<C> extends undefined ? [] : [ArgsOf<C>]
): Promise<ResultOf<C>> {
  const send = window.jm[channel] as (
    args: ArgsOf<C> | undefined,
  ) => Promise<IpcResult<ResultOf<C>>>
  return unwrap(await send(args[0]))
}
