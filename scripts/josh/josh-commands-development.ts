import {
	ESLINT_CACHE_FLAGS,
	GATE_COMMAND,
	PE,
	TS_CACHE_FLAGS,
	type CommandEntry,
} from './josh-command-types'

const FILE_ARGUMENTS = '[files...]'
const REQUIRED_FILE_ARGUMENTS = '<files...>'
const FILTER_ARGUMENTS = '[filters...]'

/* eslint-disable @typescript-eslint/naming-convention */
const DEV_COMMANDS: Record<string, CommandEntry> = {
	[GATE_COMMAND]: {
		script: 'scripts/gate/verification-gate.ts',
		description: 'Run lint, type check, spell check and unit tests concurrently',
		category: 'Development',
		reference: ['[--verbose|--force|--no-unit]', 'developer', ['files', 'processes']],
	},
	lint: {
		script: 'scripts/lint/lint-parallel.ts',
		description: 'Check code with prettier and eslint',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
	},
	'lint:related': {
		script: 'scripts/lint/lint-related.ts',
		description: 'Check only the changed files with prettier and eslint (whole tree on fallback)',
		category: 'Development',
		reference: [FILE_ARGUMENTS, 'developer', ['processes']],
	},
	lines: {
		script: 'scripts/lines/lines-command.ts',
		description: "Print a file's code lines against the max-lines limit and the headroom left",
		category: 'Development',
		reference: [REQUIRED_FILE_ARGUMENTS, 'developer', ['none']],
	},
	bytes: {
		script: 'scripts/bytes/bytes-command.ts',
		description:
			"Print an agent-read document's byte size against its ceiling and the headroom left",
		category: 'Development',
		reference: [REQUIRED_FILE_ARGUMENTS, 'developer', ['none']],
	},
	format: {
		// prettier first here, unlike `format:edited`, and deliberately: `eslint --fix` exits 1
		// whenever a non-autofixable error remains, so putting it first behind `&&` would mean one
		// unused variable anywhere in the tree stops prettier from running at all.
		shell: [
			'sh',
			'-c',
			`pnpm exec prettier --write . && pnpm exec eslint . --fix ${ESLINT_CACHE_FLAGS.join(' ')}`,
		],
		description: 'Format code with prettier and eslint',
		category: 'Development',
		reference: ['', 'developer', ['files', 'processes']],
	},
	'format:edited': {
		script: 'scripts/hooks/format-edited-file.ts',
		description: 'Claude Code hook: format the file just edited (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['files', 'processes']],
	},
	'batch:guard': {
		script: 'scripts/hooks/batch-guard.ts',
		description:
			'Claude Code hook: refuse a third consecutive single-call turn (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately.** `JOSH_BATCH_GUARD` is a per-machine preference kept in
		// `.env`, which every other command reads through `OPTIONAL_ENV_FILE_FLAGS` — but declaring any
		// `tsx_arguments` disqualifies a command from in-process dispatch (`josh-in-process.ts`), and
		// this one runs before every `Bash` call. That is the hot path joshuafolkken/kit#1342 took a
		// second ~0.16 s tsx start off. The script calls `process.loadEnvFile` itself instead, which is
		// node's own `--env-file` parser with node's own precedence.
	},
	'pretool:guard': {
		script: 'scripts/hooks/pretool-guard.ts',
		description:
			'Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately**, the same as `batch:guard` above: this is the one
		// PreToolUse hook consumers run before every guarded call, so it must stay eligible for
		// in-process dispatch rather than pay a second tsx start. Each guard it composes loads `.env`
		// through the shared loader.
	},
	'stop:guard': {
		script: 'scripts/hooks/stop-guard.ts',
		description:
			'Claude Code Stop hook: deliver the three stop-time rules — hold notify/release and issue citation (reads the Stop payload on stdin)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately**, the same as `pretool:guard` above: this runs at every
		// turn end, so it must stay eligible for in-process dispatch rather than pay a second tsx start.
		// It loads `.env` through the shared `hook-decision.ts` loader.
	},
	'session:lang': {
		script: 'scripts/josh/session-language-cli.ts',
		description:
			'Claude Code hook: print the resolved JOSH_SESSION_LANG (defaults to ja) for the session context',
		category: 'Development',
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, deliberately**, the same as `batch:guard` above: this runs on every
		// `UserPromptSubmit`, so it must stay eligible for in-process dispatch rather than pay a second
		// tsx start each turn. It calls `process.loadEnvFile` itself through the shared loader.
	},
	'cspell:dot': {
		script: 'scripts/lint/cspell-cached.ts',
		description: 'Run spell check including dotfiles',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
	},
	'test:unit': {
		script: 'scripts/test/test-unit-guard.ts',
		description:
			'Run unit tests with Vitest (skips when Vitest is absent; fails when it has no tests)',
		category: 'Development',
		reference: [FILTER_ARGUMENTS, 'developer', ['processes']],
	},
	'test:related': {
		script: 'scripts/test/test-related.ts',
		description: 'Run only the unit tests related to the changed files (full suite on fallback)',
		category: 'Development',
		reference: [FILE_ARGUMENTS, 'developer', ['processes']],
	},
	'test:declared': {
		script: 'scripts/test/test-declared.ts',
		description: 'Report whether the working-tree change needs a test (required/exempt/satisfied)',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
	},
	'e2e:retry-check': {
		script: 'scripts/test/e2e-retry-check.ts',
		description: 'Report whether the preview server crashed during a failed E2E attempt (CI)',
		category: 'Development',
		reference: ['', 'automation', ['none']],
	},
	'test:e2e': {
		script: 'scripts/test/test-e2e-guard.ts',
		description: 'Run E2E tests with Playwright (skips when absent or no e2e files)',
		category: 'Development',
		reference: [FILTER_ARGUMENTS, 'developer', ['processes']],
	},
	test: {
		shell: ['sh', '-c', 'pnpm josh test:unit && pnpm josh test:e2e'],
		description: 'Run unit and E2E tests',
		category: 'Development',
		reference: ['', 'developer', ['processes']],
		argument_targets: ['test:unit', 'test:e2e'],
	},
	check: {
		shell: [...PE, 'tsc', '--noEmit', ...TS_CACHE_FLAGS],
		description: 'Type-check TypeScript project',
		category: 'Development',
		reference: ['[arguments...]', 'developer', ['processes']],
	},
	port: {
		script: 'scripts/ports/port-command.ts',
		description: 'Print the PORT_SEED-resolved dev or preview port',
		category: 'Development',
		reference: ['<dev|preview>', 'developer', ['none']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DEV_COMMANDS }
