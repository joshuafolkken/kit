// The `josh` subcommand aliases, in a leaf of their own (joshuafolkken/kit#5128).
//
// **A reader that only expands an alias imports no command table.** The table (`josh-command-map.ts`)
// imports every command module, so a module that imported it for `canonical_command` alone — the shell
// and bundle readers of `josh time` — carried every command module into each test that reached it, and
// a one-line change to any command table re-ran hundreds of unrelated tests under `josh test:related`.

const ALIASES: Record<string, string> = {
	ga: 'gate',
	l: 'lint',
	lr: 'lint:related',
	cr: 'check:related',
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
	tpn: 'test:pinned',
	te: 'test:e2e',
	c: 'check',
	pt: 'port',
	i: 'init',
	pf: 'profile',
	st: 'start',
	sy: 'sync',
	un: 'uninstall',
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
	cdv: 'command:derive',
	u: 'latest',
	lc: 'latest:corepack',
	lu: 'latest:update',
	tm: 'time',
	tmd: 'time:density',
	rtr: 'retrospective',
	ca: 'cost:audit',
	cit: 'ci:timing',
	rvf: 'review:findings',
	rvs: 'review:stops',
	ruv: 'rule:value',
	ev: 'eval',
	fr: 'fresh:run',
	as: 'auth:setup',
	lsm: 'lane:sample',
	lst: 'lane:stats',
	lva: 'lane:value',
	lnt: 'lane:net',
	lbd: 'lane:breakdown',
	lli: 'lane:limit',
	lrs: 'lane:restart',
	lwd: 'lane:withdraw',
	lps: 'lane:pause',
	lru: 'lane:resume',
	lad: 'lane:adopt',
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

export { ALIASES, canonical_command }
