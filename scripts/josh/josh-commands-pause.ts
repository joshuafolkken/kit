import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// `run:observe`, `run:pause`, `run:split`, `run:stale` and `tree:status`. `RUN_COMMANDS` spreads this
// in after `run:release`, so the map keeps the order the run reads them in.

const PAUSE_COMMANDS: Record<string, CommandEntry> = {
	'run:observe': {
		script: 'scripts/run/observe/run-observe-cli.ts',
		description: 'Sample a process at times hours apart without holding a lane',
		category: 'AI tools',
		reference: [
			'start <issue> --at <offset>... --sample "<command>" -- <command...> | sample <issue>',
			'automation',
			['network', 'files', 'processes'],
		],
		usage: {
			examples: [
				{
					arguments:
						'start 8035 --at 30m --at 2h --sample \'ps -o rss= -p "$OBSERVE_PID"\' -- pnpm josh run:board',
					note: 'sample the board’s memory after 30 minutes and 2 hours',
				},
				{ arguments: 'sample 8035', note: 'the resumed child takes the due sample' },
			],
			flags: [
				{
					names: ['--at <offset>'],
					description: 'repeatable; a sample time after the start, as `<N>m` or `<N>h`.',
				},
				{
					names: ['--sample "<command>"'],
					description:
						'the shell command whose output is one sample; `$OBSERVE_PID` names the process.',
				},
			],
		},
	},
	'run:pause': {
		script: 'scripts/run/pause/run-pause-cli.ts',
		description: 'Set a run aside while its prerequisite lands first',
		category: 'AI tools',
		// `run:release` underneath can send the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: ['<issue> --for <prerequisite>', 'automation', ['git', 'network', 'files']],
		usage: {
			examples: [{ arguments: '1091 --for 1102', note: 'pause 1091 until 1102 lands' }],
			flags: [
				{
					names: ['--for <prerequisite>'],
					description: 'the issue that has to land first; `<issue>` is recorded blocked by it.',
				},
			],
		},
	},
	'run:split': {
		script: 'scripts/run/split/run-split-cli.ts',
		description: 'Set a run aside and place its split or prerequisite into an epic in one call',
		category: 'AI tools',
		// `run:release` underneath can send the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: [
			'<issue> (--children <N1,N2,...> [--ordered | --chain <chain>...] [--order-reason "<chain>: <reason>"...] | --prerequisite <P>) [--title <title>]',
			'automation',
			['git', 'network', 'files'],
		],
		usage: {
			examples: [
				{ arguments: '1091 --children 1102,1103 --title "Split 1091"', note: 'independent split' },
				{
					arguments:
						'A --children B --ordered --order-reason "#A -> #B: B calls the parser A adds"',
					note: 'B after A',
				},
				{ arguments: '1091 --prerequisite 1104 --title "1104 then 1091"', note: '1104 first' },
			],
			flags: [
				{
					names: ['--children <N1,N2,...>'],
					description: 'the filed split issues, comma-separated.',
				},
				{ names: ['--ordered'], description: '`<issue>` first, then the children in that order.' },
				{
					names: ['--chain <chain>'],
					description:
						'repeatable; one chain line (`#A -> #B`) among `<issue>` and the children, passed to `epic` as given — joins and branches without `--ordered`.',
				},
				{
					names: ['--order-reason "<chain>: <reason>"'],
					description:
						'repeatable; required once for each declared chain (the `--ordered` chain, or each `--chain`): what the later issue takes from the earlier one, passed to `epic` as given. A declared chain without one is refused before anything is set aside.',
				},
				{
					names: ['--prerequisite <P>'],
					description: 'the filed issue that has to land first; `<issue>` is paused on it.',
				},
				{
					names: ['--title <title>'],
					description: 'the new epic’s title; required when no epic tracks `<issue>` yet.',
				},
			],
		},
	},
	'run:stale': {
		script: 'scripts/run/stale/run-stale-main.ts',
		description: 'Remove a stale `in-progress` label no checkout still holds',
		category: 'AI tools',
		reference: ['', 'automation', ['git', 'network', 'files']],
		usage: { examples: [{ arguments: '' }] },
	},
	'tree:status': {
		script: 'scripts/run/tree-status-cli.ts',
		description:
			'Bundle the working tree’s read-only pre-check: branch, status, stash list, run hold',
		category: 'AI tools',
		// Reads the branch, status, stash list and hold only; a consultation scope runs it.
		is_read_only: true,
		reference: ['', 'automation', ['git', 'files']],
		usage: { examples: [{ arguments: '' }] },
	},
}

export { PAUSE_COMMANDS }
