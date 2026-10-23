#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { test_pinned } from './test-pinned'
import { test_pinned_logic } from './test-pinned-logic'

// The `josh test:pinned` entry: read `--max`, run, print one line per unpinned or unchecked hunk, and
// exit non-zero when any checked hunk is unpinned. An unchecked hunk alone does not fail the run — it
// was not asked about.

const CLEAN_EXIT = 0
const FAILED_EXIT = 1
const ARGV_OFFSET = 2
const USAGE = [
	'Usage: josh test:pinned [--max <n>] [--help]',
	'  revert each changed hunk of a non-test code file and run its related tests;',
	'  prints `unpinned <file>:<line>` for a hunk no test went red on, and',
	`  \`unchecked <file>:<line>\` past the --max cap (default ${String(test_pinned_logic.DEFAULT_MAX_HUNKS)})`,
].join('\n')

const PARSE_ARGS_OPTIONS = {
	help: { type: 'boolean', short: 'h', default: false },
	max: { type: 'string' },
} as const

const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h'])

// A `--max` that is not a whole number above zero is a refusal, not the default.
function valid_max(raw: string | undefined): number | undefined {
	const max = Number(raw ?? test_pinned_logic.DEFAULT_MAX_HUNKS)

	return Number.isSafeInteger(max) && max > 0 ? max : undefined
}

// `undefined` prints the usage: a help request, an unknown flag, or a missing or invalid `--max`.
function max_hunks_of(argv: ReadonlyArray<string>): number | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return values.help ? undefined : valid_max(values.max)
	} catch {
		return undefined
	}
}

// Clean for an explicit help request; a refusal for anything the parse did not understand.
function print_usage(argv: ReadonlyArray<string>): number {
	process.stderr.write(`${USAGE}\n`)

	return argv.some((argument) => HELP_FLAGS.has(argument)) ? CLEAN_EXIT : FAILED_EXIT
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
	const max_hunks = max_hunks_of(argv)
	if (max_hunks === undefined) return print_usage(argv)

	const report = await test_pinned.run(max_hunks)

	process.stdout.write(test_pinned_logic.report_text(report))

	return report.unpinned.length === 0 ? CLEAN_EXIT : FAILED_EXIT
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(ARGV_OFFSET))
}

const test_pinned_main = { main }

export { test_pinned_main }
