import type { CommandEntry } from './josh-command-types'

const EXCLUDE = '--exclude <N>'
const JUST_MERGED = 'skip the issue just merged'
const EXCLUDE_1630 = '--exclude 1630'
const BUDGET = '--answer candidates --started "$started" --active "$active"'

// The `backlog:*` command registry. It is spread into `AI_COMMANDS` so the commands stay grouped
// with the other AI tools under the 'AI tools' category.

const BACKLOG_COMMANDS: Record<string, CommandEntry> = {
	// Started from a terminal: the `backlogrun` keyword's launcher, and the board.
	backlogrun: {
		script: 'scripts/backlog/backlogrun-cli.ts',
		description:
			'Start a backlogrun in the background and show its board; with one already running, only show the board, or replace it when it is idle and the invocation differs; --stop stops it; --restart replaces its processes and keeps its record',
		category: 'AI tools',
		reference: [
			'[<n>...] [--only] [--max <n>] [--idle <minutes>] [--agent claude|codex] | --stop | --restart',
			'developer',
			['files', 'network', 'processes'],
		],
		usage: {
			examples: [
				{ arguments: '', note: 'start with the configured provider, then show the board' },
				{ arguments: '3437 --only', note: 'the arguments go to backlogrun as typed' },
				{ arguments: '--agent codex', note: 'start in Codex' },
				{ arguments: '--stop', note: 'stop the run in this repository' },
				{ arguments: '--restart', note: "replace the run's processes, keeping its record" },
			],
		},
	},
	'backlog:next': {
		script: 'scripts/backlog/backlog-next-main.ts',
		description:
			'Order the whole opted-in backlog: auto-ok issues and the descendants of auto-ok epics, transitively through nested epics',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '' }, { arguments: EXCLUDE_1630, note: JUST_MERGED }],
			flags: [
				{
					names: [EXCLUDE],
					description: 'drop issues from every bucket; comma-separated, repeatable.',
				},
			],
		},
	},
	'backlog:offer': {
		script: 'scripts/backlog/backlog-offer-main.ts',
		description:
			'Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['files', 'git', 'network', 'processes']],
		usage: {
			examples: [{ arguments: '--started "$started" --active "$active" --running 2 --retries 1' }],
		},
	},
	'backlog:drive': {
		script: 'scripts/backlog/backlog-drive-cli.ts',
		description:
			'Drive backlogrun through offer, launch and merge; restore this run’s lanes and report when complete',
		category: 'AI tools',
		reference: ['[--owner <pid>] [options]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '[--max <n>] [--idle <minutes>] [--only]' }],
		},
	},
	'backlog:triage': {
		script: 'scripts/backlog/backlog-triage-cli.ts',
		description:
			"Run a parent triage pass, decide solo/lane from three conditions, or apply one issue's verdict",
		category: 'AI tools',
		reference: [
			'--pass [--exclude <n>] | --decide --defect yes|no|unknown --verification yes|no|unknown --every-run yes|no|unknown | --apply <n> [--lane | --solo --defect yes --verification yes --every-run yes] [--blocked-by <m> | --unblock <m>] --reason <text> [--clear] | --apply <n> --adopt <k> --reason <text> [--done <text>]',
			'automation',
			['files', 'network'],
		],
		usage: {
			examples: [
				{ arguments: '--pass' },
				{ arguments: '--decide --defect yes --verification yes --every-run no' },
				{ arguments: '--apply 912 --lane --reason "<why>"' },
				{
					arguments:
						'--apply 913 --solo --defect yes --verification yes --every-run yes --reason "<why>" --clear',
				},
				{
					arguments: '--apply 914 --blocked-by 912 --reason "<why>"',
				},
				{
					arguments: '--apply 914 --unblock 912 --reason "<why>"',
				},
				{
					arguments: '--apply 915 --adopt 1 --reason "<why>"',
				},
			],
			flags: [
				{
					names: ['--pass [--exclude <N>]'],
					description:
						"settles mechanical lane candidates and prints one next command; exclude decisions kept parked. Each park's recommendation and tier go to stderr, with its `--adopt` command unless no pick or a tier C pick. Failed or incomplete reads exit 1.",
				},
				{
					names: ['--decide --defect <answer> --verification <answer> --every-run <answer>'],
					description:
						'yes/no/unknown evidence: three yes → run:solo; any no → run:lane; otherwise judge. Read-only.',
				},
				{
					names: ['--apply <N> --lane|--solo --reason <text>'],
					description: 'comments the reason, then applies the run label (`auto-ok:judge --apply`).',
				},
				{
					names: ['--clear'],
					description:
						'clears the park (`run:park <N> --clear`) only when the issue answers its decision question.',
				},
				{
					names: ['--blocked-by <M>'],
					description:
						'records the native `blocked-by` relation on `#M` before the comment and the run label, declared in the epic tracking `#N` as `run:pause` does; it stands in for the run label or goes with it.',
				},
				{
					names: ['--unblock <M>'],
					description:
						"removes it instead, with the tracking epic's `#M -> #N` declaration (`epic --remove`'s path); `--blocked-by` restores it. A failed write is named, exit 1.",
				},
				{
					names: ['--adopt <k>'],
					description:
						"takes option `<k>` of the child's latest park in one call: records the decision in its one tracking epic (`epic --decide`'s path), clears the park, then `run:add <N> --retry`. A park with no recommendation, an unlisted or tier C option, no single tracking epic, or no backlogrun running here is refused before any write.",
				},
				{
					names: ['--done <text>'],
					description:
						'what the parent did for an option whose `必要な権限` starts with `親` (e.g. `親セッション`): the parent carries the option out first, then adopts it with `--done <what was done>`, recorded with the decision. Without it such an option is refused before any write, so the child stays parked; on any other option it is refused.',
				},
			],
		},
	},
	'backlog:plan': {
		script: 'scripts/backlog/backlog-plan-cli.ts',
		description:
			'Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope',
		category: 'AI tools',
		reference: [
			'[issue...] [--only] [--waves] [--exclude <n>[,<n>...]]',
			'automation',
			['network'],
		],
		usage: {
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
	},
	'backlog:budget': {
		script: 'scripts/backlog/backlog-budget-main.ts',
		description: 'Say whether a backlogrun may start more work, keep watching, or finish',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['none']],
		usage: {
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
	},
}

export { BACKLOG_COMMANDS }
