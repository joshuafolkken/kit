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
	ga: 'gate',
	l: 'lint',
	lr: 'lint:related',
	ln: 'lines',
	lp: 'lint:prettier',
	le: 'lint:eslint',
	f: 'format',
	fp: 'format:prettier',
	fe: 'format:eslint',
	fd: 'format:edited',
	bg: 'batch:guard',
	sp: 'cspell',
	sd: 'cspell:dot',
	t: 'test',
	tu: 'test:unit',
	tr: 'test:related',
	tw: 'test:watch',
	tui: 'test:ui',
	te: 'test:e2e',
	er: 'e2e:retry-check',
	he: 'health',
	c: 'check',
	pt: 'port',
	i: 'init',
	sy: 'sync',
	sys: 'sync:scope',
	g: 'git',
	gp: 'pr',
	fu: 'followup',
	nf: 'notify',
	obf: 'observations:flush',
	ms: 'main:sync',
	mm: 'main:merge',
	bp: 'bump',
	re: 'release',
	res: 'release:scope',
	v: 'version',
	vu: 'version:upgrade',
	r: 'ranges',
	dr: 'doctor',
	pg: 'propagate',
	ad: 'adopt',
	ov: 'overrides',
	a: 'audit',
	ap: 'audit:provision',
	rt: 'reconcile-templates',
	swp: 'sync-workflow-pins',
	sdp: 'sync-dependabot-pins',
	u: 'latest',
	lc: 'latest:corepack',
	lu: 'latest:update',
	ls: 'latest:scope',
	pm: 'prevent-main-commit',
	cm: 'check-commit-message',
	ss: 'secretlint-scan',
	ppu: 'pre-push-unit',
	ptc: 'pre-commit-type-check',
	hi: 'hook:install',
	hu: 'hook:uninstall',
	hc: 'hook:commit',
	hp: 'hook:push',
	pp: 'prep',
	is: 'issue',
	ird: 'issue:read',
	ist: 'issue:state',
	isc: 'issue:scout',
	ep: 'epic',
	ec: 'epic:check',
	en: 'epic:next',
	ea: 'epic:audit',
	el: 'epic:plan',
	eb: 'epic:bundle',
	ao: 'auto-ok:next',
	bl: 'backlog:next',
	blp: 'backlog:plan',
	bb: 'backlog:budget',
	dsh: 'depth:share',
	co: 'cost',
	ds: 'doc:section',
	rs: 'read:set',
	tm: 'time',
	ly: 'layers',
	bn: 'bench',
	rl: 'review:level',
	rb: 'review:brief',
	r2: 'review:round2',
	ra: 'review:attest',
	dg: 'delegate',
	rh: 'run:hold',
	rr: 'run:release',
	rc: 'run:carry',
	rw: 'run:wake',
	rp: 'run:preflight',
	rv: 'run:liveness',
	rg: 'run:progress',
	lno: 'lane:open',
	lnc: 'lane:close',
	lnl: 'lane:list',
	lnp: 'lane:prune',
	lnv: 'lane:output',
	lnd: 'lane:dispatch',
	ig: 'investigation:guard',
	rug: 'rule:guard',
	ruv: 'rule:value',
	ev: 'eval',
	es: 'eval:scope',
}

// The canonical name of a `josh` subcommand: an alias expands, and anything else passes through
// unchanged (joshuafolkken/kit#1789).
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
