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
	fd: 'format:edited',
	sp: 'cspell',
	sd: 'cspell:dot',
	t: 'test',
	tu: 'test:unit',
	tw: 'test:watch',
	tui: 'test:ui',
	te: 'test:e2e',
	er: 'e2e:retry-check',
	he: 'health',
	c: 'check',
	pt: 'port',
	i: 'init',
	sy: 'sync',
	g: 'git',
	gp: 'pr',
	fu: 'followup',
	nf: 'notify',
	ms: 'main:sync',
	mm: 'main:merge',
	bp: 'bump',
	v: 'version',
	vu: 'version:upgrade',
	r: 'ranges',
	dr: 'doctor',
	pg: 'propagate',
	ov: 'overrides',
	a: 'audit',
	rt: 'reconcile-templates',
	swp: 'sync-workflow-pins',
	sdp: 'sync-dependabot-pins',
	u: 'latest',
	lc: 'latest:corepack',
	lu: 'latest:update',
	pm: 'prevent-main-commit',
	cm: 'check-commit-message',
	ss: 'secretlint-scan',
	hi: 'hook:install',
	hu: 'hook:uninstall',
	hc: 'hook:commit',
	hp: 'hook:push',
	pp: 'prep',
	is: 'issue',
	ep: 'epic',
	ec: 'epic:check',
	en: 'epic:next',
	ea: 'epic:audit',
	el: 'epic:plan',
	eb: 'epic:bundle',
	ev: 'eval',
}

export type { CommandCategory, CommandEntry } from './josh-command-types'
export { ALIASES, CATEGORY_ORDER, COMMAND_MAP }
