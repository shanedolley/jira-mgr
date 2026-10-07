import type { Handler } from '../context.js'
import type { CommandId, SpecOf } from '../schema.js'
import { help } from './help.js'

/** Command id to handler. A spec with no entry here stays out of the CLI, its help and the reference. */
export const HANDLERS = { help } as const satisfies { [Id in CommandId]?: Handler<SpecOf<Id>> }
