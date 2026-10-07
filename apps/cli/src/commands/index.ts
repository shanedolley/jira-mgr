import type { Handler } from '../context.js'
import type { CommandId, SpecOf } from '../schema.js'
import { login } from './auth/login.js'
import { logout } from './auth/logout.js'
import { status } from './auth/status.js'
import { options } from './field/options.js'
import { help } from './help.js'
import { get } from './issue/get.js'
import { list } from './issue/list.js'
import { tree } from './issue/tree.js'
import { types } from './link/types.js'
import { list as sprintList } from './sprint/list.js'
import { list as viewList } from './view/list.js'

/** Command id to handler. A spec with no entry here stays out of the CLI, its help and the reference. */
export const HANDLERS = {
  help,
  'auth login': login,
  'auth status': status,
  'auth logout': logout,
  'issue list': list,
  'issue tree': tree,
  'issue get': get,
  'field options': options,
  'link types': types,
  'sprint list': sprintList,
  'view list': viewList,
} as const satisfies { [Id in CommandId]?: Handler<SpecOf<Id>> }
