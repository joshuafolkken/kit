import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const REPO = '--repo <owner/repo>'
const EXCLUDE = '--exclude <N>'
const JUST_MERGED = 'skip the issue just merged'

// The epic and auto-ok commands, split out of `josh-commands-ai.ts` when each command's usage moved onto
// its entry (#4185). `AI_COMMANDS` spreads this in at the same place, so the map keeps its order.

/* eslint-disable @typescript-eslint/naming-convention */
const EPIC_COMMANDS: Record<string, CommandEntry> = {
	epic: {
		script: 'scripts/epic/epic.ts',
		// `--notify` sends the `planning` Telegram (epic-notify.ts), which reads `.env`.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Create an epic issue from its child issue numbers',
		category: 'AI tools',
		reference: ['<title> <issue...> [--ordered]', 'automation', ['network']],
		usage: {
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
				{ arguments: '--decide 893 894 --decision-file why.md' },
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
					names: ['--notify'],
					description:
						"on create or `--promote`: send the split path's `planning` Telegram (the epic's URL, every child's URL and `Next: backlogrun #<E> --only`), the same send as `issue:plan --planned`; a failed send only warns.",
				},
				{
					names: ['--title <title>'],
					description: 'with `--promote`: rename the issue first.',
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
	},
	'epic:next': {
		script: 'scripts/epic/epic-next-main.ts',
		description: "List an epic's runnable children, bundled per repository",
		category: 'AI tools',
		reference: ['<epic>... [--repo <owner/repo>] [--lanes]', 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '858' },
				{
					arguments: '858 --repo joshuafolkken/kit',
					note: 'just the next child for one repository',
				},
				{
					arguments: '858 --repo joshuafolkken/kit --lanes',
					note: 'one child per free lane there',
				},
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
						'print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 8. Prints `triage` instead while any candidate carries neither `run:solo` nor `run:lane` (the triage gate in `josh backlog:next`).',
				},
			],
		},
	},
	'epic:bundle': {
		script: 'scripts/epic/epic-bundle-main.ts',
		description: 'Say whether a newly filed issue belongs with ones already in the backlog',
		category: 'AI tools',
		reference: ['<issue> [--apply]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '874' }, { arguments: '874 --apply', note: 'write it' }],
		},
	},
	'epic:audit': {
		script: 'scripts/epic/epic-audit-cli.ts',
		description: "Audit an epic's children against each other for contradictions",
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
		usage: { examples: [{ arguments: '858' }] },
	},
	'epic:check': {
		script: 'scripts/epic/epic-check.ts',
		description: 'Check an epic issue against the tracking requirements',
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
		usage: { examples: [{ arguments: '700' }] },
	},
	'auto-ok:next': {
		script: 'scripts/auto-ok/auto-ok-main.ts',
		description: 'Print the next opted-in issue an unattended run may pick up outside an epic',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]] [--label <name>]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '' }, { arguments: '--exclude 906', note: JUST_MERGED }],
			flags: [
				{
					names: [EXCLUDE],
					description: 'drop issues from the answer; comma-separated, repeatable.',
				},
			],
		},
	},
	'auto-ok:judge': {
		script: 'scripts/auto-ok/auto-ok-judge-cli.ts',
		description:
			'List the open issues backlogrun owes an auto-ok judgement, or record one (--apply / --decline)',
		category: 'AI tools',
		reference: [
			'[--apply <n> (--lane | --solo) | --decline <n> --reason <text>]',
			'automation',
			['network'],
		],
		usage: {
			examples: [
				{ arguments: '', note: 'the issues that still owe a judgement' },
				{ arguments: '--apply 912 --lane', note: 'opt it in, with its run label' },
				{ arguments: '--decline 913 --reason "<why>"', note: 'record why it stays out' },
			],
			flags: [
				{
					names: ['--apply <N> --lane|--solo'],
					description:
						'checks the exclusions again against the labels as they stand, records the judgement on the issue, then applies the run label and then `auto-ok`.',
				},
				{ names: ['--decline <N> --reason <text>'], description: 'applies nothing.' },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { EPIC_COMMANDS }
