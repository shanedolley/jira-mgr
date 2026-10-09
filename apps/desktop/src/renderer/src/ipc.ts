import { JiraMgrError } from '@jira-mgr/core'

import type { ArgsOf, Channel, IpcResult, ResultOf } from '../../shared/ipc'

/** The data of an `ok` result, or the core error a failed one carries, rebuilt as a `JiraMgrError`. */
export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  throw new JiraMgrError(result.error.code, result.error.message)
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
