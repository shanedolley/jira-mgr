import type { Handler } from '../context.js'
import type { CommandId, SpecOf } from '../schema.js'
import { login } from './auth/login.js'
import { logout } from './auth/logout.js'
import { status } from './auth/status.js'
import { add as attachAdd } from './attach/add.js'
import { list as attachList } from './attach/list.js'
import { remove as attachRemove } from './attach/remove.js'
import { add as commentAdd } from './comment/add.js'
import { del as commentDelete } from './comment/delete.js'
import { edit as commentEdit } from './comment/edit.js'
import { list as commentList } from './comment/list.js'
import { options } from './field/options.js'
import { help } from './help.js'
import { create } from './issue/create.js'
import { del } from './issue/delete.js'
import { edit } from './issue/edit.js'
import { get } from './issue/get.js'
import { list } from './issue/list.js'
import { tree } from './issue/tree.js'
import { add as linkAdd } from './link/add.js'
import { list as linkList } from './link/list.js'
import { remove as linkRemove } from './link/remove.js'
import { types } from './link/types.js'
import { list as sprintList } from './sprint/list.js'
import { set as sprintSet } from './sprint/set.js'
import { set as statusSet } from './status/set.js'
import { list as viewList } from './view/list.js'
import { add as worklogAdd } from './worklog/add.js'
import { del as worklogDelete } from './worklog/delete.js'
import { edit as worklogEdit } from './worklog/edit.js'
import { list as worklogList } from './worklog/list.js'

/** Command id to handler. A spec with no entry here stays out of the CLI, its help and the reference. */
export const HANDLERS = {
  help,
  'auth login': login,
  'auth status': status,
  'auth logout': logout,
  'issue list': list,
  'issue tree': tree,
  'issue get': get,
  'issue create': create,
  'issue edit': edit,
  'issue delete': del,
  'status set': statusSet,
  'field options': options,
  'comment list': commentList,
  'comment add': commentAdd,
  'comment edit': commentEdit,
  'comment delete': commentDelete,
  'worklog list': worklogList,
  'worklog add': worklogAdd,
  'worklog edit': worklogEdit,
  'worklog delete': worklogDelete,
  'link types': types,
  'link list': linkList,
  'link add': linkAdd,
  'link remove': linkRemove,
  'attach list': attachList,
  'attach add': attachAdd,
  'attach remove': attachRemove,
  'sprint list': sprintList,
  'sprint set': sprintSet,
  'view list': viewList,
} as const satisfies { [Id in CommandId]?: Handler<SpecOf<Id>> }
