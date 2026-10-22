import type { ShapeExpectations } from './shell-shape-corpus-fixture'

// What the command readers outside the delivered rules extract from each shell shape: the verification
// commands `lane:stats` counts (`lane-transcript-stats.ts`) and the executable `run:board` names
// (`run-board-usage-listing.ts`).
const VERIFICATION_COMMANDS: ShapeExpectations<ReadonlyArray<string>> = {
	plain: ['gate'],
	'multiline-quoted-field': [],
	'curl-data-file': [],
	'quoted-mention': [],
	'hyperfine-quoted': [],
	'time-flag-value': [],
	'env-timeout-wrapper': [],
	'command-substitution': [],
	'semicolon-chain': [],
	'and-chain': [],
	pipe: ['gate'],
	subshell: [],
	'heredoc-mention': [],
	'name-prefix': [],
}

const EXECUTABLES: ShapeExpectations<string> = {
	plain: 'pnpm',
	'multiline-quoted-field': 'gh',
	'curl-data-file': 'curl',
	'quoted-mention': 'echo',
	'hyperfine-quoted': 'hyperfine',
	'time-flag-value': '/usr/bin/time',
	'env-timeout-wrapper': 'CI=1',
	'command-substitution': 'out="$(pnpm',
	'semicolon-chain': 'git',
	'and-chain': 'git',
	pipe: 'pnpm',
	subshell: '(cd',
	'heredoc-mention': 'cat',
	'name-prefix': 'pnpm',
}

const shell_shape_readers_fixture = { EXECUTABLES, VERIFICATION_COMMANDS }

export { shell_shape_readers_fixture }
