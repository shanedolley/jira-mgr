import { start } from './app'
import { createBackend } from './backend'
import { chooseSavePath } from './save'

start(createBackend({ chooseSavePath }))
