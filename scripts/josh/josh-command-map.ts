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

const ALIASES: Record<string, string> = {
	ga: 'gate',
	l: 'lint',
	lr: 'lint:related',
	ln: 'lines',
	by: 'bytes',
	mt: 'metrics',
	f: 'format',
	sd: 'cspell:dot',
	bh: 'behavior',
	eu: 'exports:unused',
	t: 'test',
	tu: 'test:unit',
	tr: 'test:related',
	td: 'test:declared',
	trd: 'test:red',
	te: 'test:e2e',
	c: 'check',
	pt: 'port',
	i: 'init',
	pf: 'profile',
	st: 'start',
	sy: 'sync',
	rmi: 'registry:migrate',
	g: 'git',
	gp: 'pr',
	ms: 'main:sync',
	mm: 'main:merge',
	bp: 'bump',
	re: 'release',
	v: 'version',
	r: 'ranges',
	dr: 'doctor',
	rc: 'ruleset:check',
	pg: 'propagate',
	ad: 'adopt',
	ov: 'overrides',
	a: 'audit',
	rt: 'reconcile-templates',
	u: 'latest',
	lc: 'latest:corepack',
	lu: 'latest:update',
	tm: 'time',
	tmd: 'time:density',
	rtr: 'retrospective',
	rvf: 'review:findings',
	ruv: 'rule:value',
	ev: 'eval',
	lsm: 'lane:sample',
	lst: 'lane:stats',
	lli: 'lane:limit',
	blr: 'backlogrun',
}

// The canonical name of a `josh` subcommand: an alias expands, and anything else passes through
// unchanged.
//
// **The expansion is one rule, so it lives beside the table it reads.** Two readers had each written
// their own `ALIASES[name] ?? name` — the layer report and the gate-run count — and a third, the run
// measurement's command key, had not, so `pnpm josh ga` and `pnpm josh gate` were measured as two
// different commands. A lookup is small enough to copy and exactly the kind of copy that drifts: the
// two that had it disagreed with the one that did not about whether a call was the gate.
//
// **`Object.hasOwn` rather than a bare lookup**, because a subcommand spelled like a member of
// `Object.prototype` — `constructor`, `toString` — would otherwise come back as that member instead
// of as itself, and the caller would key a call by something that is not a command name at all.
function canonical_command(name: string): string {
	if (!Object.hasOwn(ALIASES, name)) return name

	return ALIASES[name] ?? name
}

export type { CommandCategory, CommandEntry } from './josh-command-types'
export { ALIASES, CATEGORY_ORDER, COMMAND_MAP, canonical_command }
