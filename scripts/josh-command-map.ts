import type { CommandCategory, CommandEntry } from './josh-command-types'
import { AI_COMMANDS } from './josh-commands-ai'
import { DEV_COMMANDS } from './josh-commands-development'
import { HOOKS_COMMANDS } from './josh-commands-hooks'
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
}

const ALIASES: Record<string, string> = {
	l: 'lint',
	lp: 'lint:prettier',
	le: 'lint:eslint',
	f: 'format',
	fp: 'format:prettier',
	fe: 'format:eslint',
	sp: 'cspell',
	sd: 'cspell:dot',
	t: 'test',
	tu: 'test:unit',
	te: 'test:e2e',
	c: 'check',
	sv: 'check:svelte',
	sc: 'check:svelte:ci',
	i: 'init',
	sy: 'sync',
	il: 'install',
	g: 'git',
	fu: 'followup',
	nf: 'notify',
	ms: 'main:sync',
	mm: 'main:merge',
	bp: 'bump',
	v: 'version',
	ov: 'overrides',
	a: 'audit',
	u: 'latest',
	lc: 'latest:corepack',
	lu: 'latest:update',
	pm: 'prevent-main-commit',
	cm: 'check-commit-message',
	hi: 'hook:install',
	hu: 'hook:uninstall',
	hc: 'hook:commit',
	hp: 'hook:push',
	pp: 'prep',
	is: 'issue',
}

export type { CommandCategory, CommandEntry } from './josh-command-types'
export { ALIASES, CATEGORY_ORDER, COMMAND_MAP }
