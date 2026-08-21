import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolve_tsx_runner } from './josh-logic'

// #825: `--port $(josh port dev)` substitutes stdout straight into a command line, so every failure
// path of the CLI has to leave that stream empty. The unit tests cover each writer in isolation;
// only running the real CLI proves the promise end to end, which is what was missing when
// `handle_unknown` printed the help listing to stdout and an unresolved command name fed the whole
// toolkit index into the port argument.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const JOSH_ENTRY = path.join(REPO_ROOT, 'scripts', 'josh', 'josh.ts')
// The same resolver the CLI itself spawns through, rather than `node_modules/.bin/tsx`: pnpm's
// nested shim hardcodes the store path of the tsx present when it was written, so it dies with
// MODULE_NOT_FOUND after a tsx bump (see `resolve_tsx_cli_from`). Reaching for it here would turn
// the next `josh latest` into six failures that say nothing about the stdout contract under test.
const TSX_RUNNER = resolve_tsx_runner()
const DIGITS_ONLY = /^\d+$/u
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const INVALID_SEED = 'not-a-number'
const UNKNOWN_CMD = 'not-a-command'
const USAGE_LINE = 'Usage: josh <command>'
const HELP_COMMANDS: ReadonlyArray<string> = ['help', '--help', '-h']

interface CliResult {
	stdout: string
	exit_code: number | undefined
}

function run_josh(cli_arguments: ReadonlyArray<string>, seed?: string): CliResult {
	const result = execaSync(
		TSX_RUNNER.executable,
		[...TSX_RUNNER.leading_arguments, JOSH_ENTRY, ...cli_arguments],
		{
			cwd: REPO_ROOT,
			reject: false,
			env: seed === undefined ? {} : { PORT_SEED: seed },
		},
	)

	return { stdout: result.stdout, exit_code: result.exitCode }
}

// Each of these resolved no port, so each must hand the substitution an empty string rather than
// prose the shell would pass on as the port argument.
const SILENT_FAILURES: ReadonlyArray<readonly [string, ReadonlyArray<string>, string | undefined]> =
	[
		['an unknown command', [UNKNOWN_CMD], undefined],
		['an unknown subcommand', ['port', 'bogus'], undefined],
		['a missing port name', ['port'], undefined],
		['an extra argument', ['port', 'dev', 'preview'], undefined],
		['an invalid seed', ['port', 'dev'], INVALID_SEED],
	]

describe('josh CLI stdout', () => {
	it.each(SILENT_FAILURES)('writes nothing to stdout for %s', (_label, cli_arguments, seed) => {
		const result = run_josh(cli_arguments, seed)

		expect(result.stdout).toBe('')
		expect(result.exit_code).toBe(FAILURE_EXIT_CODE)
	})

	it('writes the resolved port and nothing else on success', () => {
		const result = run_josh(['port', 'dev'])

		expect(result.stdout).toMatch(DIGITS_ONLY)
		expect(result.exit_code).toBe(SUCCESS_EXIT_CODE)
	})

	// The other half of the contract: stdout stays empty only where nothing was resolved. A reader
	// asking for the listing still gets it there, which a `--help` routed into the unknown-command
	// path would not.
	it.each(HELP_COMMANDS)('writes the help listing to stdout for %s', (help_command) => {
		const result = run_josh([help_command])

		expect(result.stdout).toContain(USAGE_LINE)
		expect(result.exit_code).toBe(SUCCESS_EXIT_CODE)
	})
})
