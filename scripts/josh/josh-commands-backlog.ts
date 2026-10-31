import type { CommandEntry } from './josh-command-types'

const EXCLUDE = '--exclude <N>'
const JUST_MERGED = 'skip the issue just merged'
const EXCLUDE_1630 = '--exclude 1630'
const BUDGET = '--answer candidates --started "$started" --active "$active"'

// The `backlog:*` command registry, split out of `josh-commands-ai.ts` so that file stays under its
// 300-code-line limit, exactly as `LANE_COMMANDS` and `SPLIT_COMMANDS` were for the same reason.
// It is spread into `AI_COMMANDS` so the commands
// stay grouped with the other AI tools under the 'AI tools' category.

/* eslint-disable @typescript-eslint/naming-convention */
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
		reference: ['[--exclude <n>[,<n>...]] [--repo <owner/repo>]', 'automation', ['network']],
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
		reference: ['--owner <pid> [options]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '--owner "$PPID" [--max <n>] [--idle <minutes>] [--only]' }],
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
/* eslint-enable @typescript-eslint/naming-convention */

export { BACKLOG_COMMANDS }
