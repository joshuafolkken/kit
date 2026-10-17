import type { CommandUsage } from './josh-command-types'

// The usage of the epic and backlog commands `docs/josh-commands-backlog.md` documents under "Epics
// and backlog", keyed by command name. The page's usage blocks are generated from this table and
// `josh help <command>` prints it, so an example or a flag is written once, here (#3938).
const EXCLUDE = '--exclude <N>'
const BUDGET = '--answer candidates --started "$started" --active "$active"'
const REPO = '--repo <owner/repo>'
const JUST_MERGED = 'skip the issue just merged'
const EXCLUDE_1630 = '--exclude 1630'

/* eslint-disable @typescript-eslint/naming-convention */
const BACKLOG_USAGE: Readonly<Record<string, CommandUsage>> = {
	epic: {
		examples: [
			{ arguments: '"Epic: split the parser work" 101 102 103' },
			{ arguments: '"Epic: staged rollout" 101 102 --ordered' },
			{ arguments: '"Epic: ..." 101 102 --rationale-file rationale.md' },
			{ arguments: '--promote 858 101 102 103', note: 'turn an existing issue into an epic' },
			{ arguments: '--add 893 894', note: 'track #894, declaring no order for it' },
			{ arguments: '--add 893 894 --before 891', note: '#894 must finish before #891' },
			{ arguments: '--add 893 894 --after 890', note: '#894 starts once #890 is done' },
			{ arguments: '--add 893 894 --decision-file why.md', note: '…and record why, in one call' },
			{
				arguments: '--reconcile 2184',
				note: 'rewrite the body to match the recorded blocked-by, and record any order the body declared',
			},
		],
		flags: [
			{
				names: ['--ordered'],
				description:
					'argument order is the dependency order; writes the arrow chain, records the matching `blocked-by` relations, and adds a `### Declared order` entry under `## Decisions`.',
			},
			{
				names: ['--rationale-file <path|->'],
				description: 'split rationale prose (`-` reads stdin).',
			},
			{
				names: ['--origin <owner/repo#N>'],
				description: 'backlink when the split originated in another repository.',
			},
			{
				names: ['--before <M>'],
				description:
					'with `--add`: insert before `#M`, re-pointing what `#M` was waiting on so the chain is never broken.',
			},
			{
				names: ['--after <M>'],
				description:
					'with `--add`: start after `#M`; branches when `#M` already has a successor, extends when it is a tail.',
			},
			{
				names: ['--order-before <M>', '--order-after <M>'],
				description: 'with `--add`: move the task-list row only; write no `blocked-by` relation.',
			},
			{
				names: ['--decision-file <path|->'],
				description: 'with `--add`: record why the child was placed.',
			},
			{
				names: ['--remove <E> <M> <N> [<N2> …]'],
				description:
					'delete a declared order from the body and the relations; each consecutive pair is one link.',
			},
		],
	},
	'epic:next': {
		examples: [
			{ arguments: '858' },
			{ arguments: '858 --repo joshuafolkken/kit', note: 'just the next child for one repository' },
			{ arguments: '858 --repo joshuafolkken/kit --lanes', note: 'one child per free lane there' },
		],
		flags: [
			{
				names: [REPO],
				description:
					'answer for one repository; stdout carries one token (an issue number, or `wait`/`stop`/`complete`), everything else on stderr.',
			},
			{
				names: ['--lanes'],
				description:
					'print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 4. Prints `triage` instead while any candidate carries neither `run:solo` nor `run:lane` (the triage gate in `josh backlog:next`).',
			},
		],
	},
	'epic:bundle': { examples: [{ arguments: '874' }] },
	'epic:audit': { examples: [{ arguments: '858' }] },
	'epic:check': { examples: [{ arguments: '700' }] },
	'auto-ok:next': {
		examples: [{ arguments: '' }, { arguments: '--exclude 906', note: JUST_MERGED }],
		flags: [
			{
				names: [EXCLUDE],
				description: 'drop issues from the answer; comma-separated, repeatable.',
			},
		],
	},
	'auto-ok:judge': {
		examples: [
			{ arguments: '', note: 'the issues that still owe a judgement' },
			{ arguments: '--apply 912 --lane', note: 'opt it in, with its run label' },
			{ arguments: '--decline 913 --reason "<why>"', note: 'record why it stays out' },
		],
		flags: [
			{
				names: ['--apply <N> --lane|--solo'],
				description:
					'checks the exclusions again against the labels as they stand, applies the run label and then `auto-ok`, and notes it on the progress board.',
			},
			{ names: ['--decline <N> --reason <text>'], description: 'applies nothing.' },
		],
	},
	'backlog:next': {
		examples: [{ arguments: '' }, { arguments: EXCLUDE_1630, note: JUST_MERGED }],
		flags: [
			{
				names: [EXCLUDE],
				description: 'drop issues from every bucket; comma-separated, repeatable.',
			},
		],
	},
	'backlog:plan': {
		examples: [
			{ arguments: '' },
			{ arguments: EXCLUDE_1630, note: 'after #1630 merged' },
			{ arguments: '--waves', note: 'the run order, wave by wave' },
		],
		flags: [
			{ names: [EXCLUDE], description: 'same exclusion as `backlog:next`.' },
			{
				names: ['--waves'],
				description:
					'print the order the run takes, wave by wave, assuming each wave merges before the next. Read-only.',
			},
		],
	},
	'backlog:stalled': { examples: [{ arguments: '' }] },
	'backlog:budget': {
		examples: [
			{ arguments: BUDGET },
			{ arguments: '--answer exhausted --started "$started" --active "$active" --idle 60' },
			{ arguments: `${BUDGET} --merged 3 --running 2 --max 5` },
		],
		flags: [
			{
				names: ['--answer <candidates|exhausted|blocked|parked|unreadable|untriaged>'],
				description: "`backlog:next`'s answer, mapped.",
			},
			{
				names: ['--started', '--active'],
				description:
					'when the invocation began / when it last had work (required unless the watch is off).',
			},
			{
				names: ['--idle <minutes>'],
				description:
					'once nothing can proceed, keep polling this long, counted from `--active` (default 480, 8 hours; `--idle 0` turns the watch off).',
			},
			{
				names: ['--max <count>'],
				description:
					'issues one invocation may take (default unlimited); `--merged` and `--running` count against it.',
			},
			{
				names: ['--json'],
				description: 'collapse verdict and reason into `{"budget": "<verdict>", "reason": "…"}`.',
			},
		],
	},
	'backlog:offer': {
		examples: [{ arguments: '--started "$started" --active "$active" --running 2 --retries 1' }],
	},
	'backlog:drive': {
		examples: [{ arguments: '--owner "$PPID" [--max <n>] [--idle <minutes>] [--only]' }],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { BACKLOG_USAGE }
