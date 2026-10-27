import type { CommandCategory, CommandEntry } from './josh-command-types'
import { AI_COMMANDS } from './josh-commands-ai'
import { CLONE_COMMANDS } from './josh-commands-clone'
import { DEV_COMMANDS } from './josh-commands-development'
import { HOOKS_COMMANDS } from './josh-commands-hooks'
import { LINT_COMMANDS } from './josh-commands-lint'
import { MAINTENANCE_COMMANDS } from './josh-commands-maintenance'
import { PROJECT_COMMANDS } from './josh-commands-project'
import { VERSIONING_COMMANDS } from './josh-commands-versioning'
import { WORKFLOW_COMMANDS } from './josh-commands-workflow'

const CATEGORY_ORDER: ReadonlyArray<CommandCategory> = [
	'Development',
	'Project',
	'Workflow',
	'Versioning',
	'Maintenance',
	'Git hooks',
	'AI tools',
]

const COMMAND_MAP: Record<string, CommandEntry> = {
	...DEV_COMMANDS,
	...PROJECT_COMMANDS,
	...WORKFLOW_COMMANDS,
	...VERSIONING_COMMANDS,
	...MAINTENANCE_COMMANDS,
	...HOOKS_COMMANDS,
	...AI_COMMANDS,
	...LINT_COMMANDS,
	...CLONE_COMMANDS,
}

export type { CommandCategory, CommandEntry } from './josh-command-types'
export { CATEGORY_ORDER, COMMAND_MAP }
