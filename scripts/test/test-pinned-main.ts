#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { test_pinned } from './test-pinned'
import { test_pinned_logic, type PinnedReport } from './test-pinned-logic'
import { test_pinned_record } from './test-pinned-record'

// The `josh test:pinned` entry: read `--max`, run, print one line per unpinned or unchecked hunk, and
// exit non-zero when any checked hunk is unpinned. An unchecked hunk alone does not fail the run — it
// was not asked about.

const CLEAN_EXIT = 0
const FAILED_EXIT = 1
const ARGV_OFFSET = 2
const USAGE = [
	'Usage: josh test:pinned [--max <n>] [--record] [--help]',
	'  revert each changed hunk of a non-test code file and run its related tests;',
	'  prints `unpinned <file>:<line>` for a hunk no test went red on, and',
	`  \`unchecked <file>:<line>\` past the --max cap (default ${String(test_pinned_logic.DEFAULT_MAX_HUNKS)});`,
	'  --record also leaves the answer for `josh run:review --join`',
].join('\n')

const PARSE_ARGS_OPTIONS = {
	help: { type: 'boolean', short: 'h', default: false },
	max: { type: 'string' },
	record: { type: 'boolean', default: false },
} as const

const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h'])

interface PinnedOptions {
	max_hunks: number
	is_record: boolean
}

// A `--max` that is not a whole number above zero is a refusal, not the default.
function valid_max(raw: string | undefined): number | undefined {
	const max = Number(raw ?? test_pinned_logic.DEFAULT_MAX_HUNKS)

	return Number.isSafeInteger(max) && max > 0 ? max : undefined
}

// `undefined` prints the usage: a help request, an unknown flag, or a missing or invalid `--max`.
function options_of(argv: ReadonlyArray<string>): PinnedOptions | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })
		const max_hunks = valid_max(values.max)

		if (max_hunks === undefined || values.help) return undefined

		return { max_hunks, is_record: values.record }
	} catch {
		return undefined
	}
}

// Clean for an explicit help request; a refusal for anything the parse did not understand.
function print_usage(argv: ReadonlyArray<string>): number {
	process.stderr.write(`${USAGE}\n`)

	return argv.some((argument) => HELP_FLAGS.has(argument)) ? CLEAN_EXIT : FAILED_EXIT
}

// `--record` leaves an answer however the run ends — a check that could not run included — so the
// join waiting on it never waits on a check that died.
async function recorded_run(max_hunks: number): Promise<PinnedReport> {
	try {
		const report = await test_pinned.run(max_hunks)

		test_pinned_record.write(test_pinned_record.summary_of(report))

		return report
	} catch (error: unknown) {
		test_pinned_record.write(test_pinned_record.not_run_summary(error))

		throw error
	}
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
	const options = options_of(argv)
	if (options === undefined) return print_usage(argv)

	const report = options.is_record
		? await recorded_run(options.max_hunks)
		: await test_pinned.run(options.max_hunks)

	process.stdout.write(test_pinned_logic.report_text(report))

	return report.unpinned.length === 0 ? CLEAN_EXIT : FAILED_EXIT
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(ARGV_OFFSET))
}

const test_pinned_main = { main }

export { test_pinned_main }
