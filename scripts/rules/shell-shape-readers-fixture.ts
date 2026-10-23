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
	'time-flag-gate': ['gate'],
	'env-timeout-gate': ['gate'],
	'command-substitution': [],
	'gate-substitution': ['gate'],
	'semicolon-chain': [],
	'and-chain': [],
	pipe: ['gate'],
	subshell: [],
	'heredoc-mention': [],
	'name-prefix': [],
}

// The first `ps` column word, kept as it is: an assignment is not in `ps`'s arguments, so `run:board`
// never meets one there (#4525).
const ENV_PREFIX = 'CI=1'
const TIME_BINARY = '/usr/bin/time'
const ASSIGNED_SUBSTITUTION = 'out="$(pnpm'

const EXECUTABLES: ShapeExpectations<string> = {
	plain: 'pnpm',
	'multiline-quoted-field': 'gh',
	'curl-data-file': 'curl',
	'quoted-mention': 'echo',
	'hyperfine-quoted': 'hyperfine',
	'time-flag-value': TIME_BINARY,
	'env-timeout-wrapper': ENV_PREFIX,
	'time-flag-gate': TIME_BINARY,
	'env-timeout-gate': ENV_PREFIX,
	'command-substitution': ASSIGNED_SUBSTITUTION,
	'gate-substitution': ASSIGNED_SUBSTITUTION,
	'semicolon-chain': 'git',
	'and-chain': 'git',
	pipe: 'pnpm',
	subshell: '(cd',
	'heredoc-mention': 'cat',
	'name-prefix': 'pnpm',
}

const shell_shape_readers_fixture = { EXECUTABLES, VERIFICATION_COMMANDS }

export { shell_shape_readers_fixture }
