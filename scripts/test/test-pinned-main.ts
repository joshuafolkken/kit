#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { review_tree } from '#scripts/review/review-tree'
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
	'Usage: josh test:pinned [--max <n>] [--record <token>] [--help]',
	'  revert each changed code hunk outside tests and fixtures only they reach, and run its related tests;',
	'  prints `unpinned <file>:<line>` for a hunk no test went red on, and',
	`  \`unchecked <file>:<line>\` past the --max cap (default ${String(test_pinned_logic.DEFAULT_MAX_HUNKS)});`,
	'  --record also leaves the answer, under <token>, for `josh run:review --join`',
].join('\n')

const PARSE_ARGS_OPTIONS = {
	help: { type: 'boolean', short: 'h', default: false },
	max: { type: 'string' },
	record: { type: 'string' },
} as const

const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h'])
// A tree still moving after this many checks is answered as not checked rather than waited on.
const MAX_CHECKS = 3
const MOVING_NOTE = `the tree kept moving across ${String(MAX_CHECKS)} checks`

interface PinnedOptions {
	max_hunks: number
	record_token: string | undefined
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

		return { max_hunks, record_token: values.record }
	} catch {
		return undefined
	}
}

// Clean for an explicit help request; a refusal for anything the parse did not understand.
function print_usage(argv: ReadonlyArray<string>): number {
	process.stderr.write(`${USAGE}\n`)

	return argv.some((argument) => HELP_FLAGS.has(argument)) ? CLEAN_EXIT : FAILED_EXIT
}

async function tree_digest(): Promise<string> {
	return JSON.stringify(await review_tree.read_changed_tree())
}

// The recorded check runs beside a review that may fix in place, and it reads the tree at more than
// one moment; a check the tree moved under is run again, so its answer is about one tree.
async function settled_run(max_hunks: number): Promise<PinnedReport> {
	for (let attempt = 0; attempt < MAX_CHECKS; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- each check runs only once the last one saw the tree move
		const before = await tree_digest()
		// eslint-disable-next-line no-await-in-loop -- as above
		const report = await test_pinned.run(max_hunks)
		// eslint-disable-next-line no-await-in-loop -- as above
		if ((await tree_digest()) === before) return report
	}

	throw new Error(MOVING_NOTE)
}

// `--record` leaves an answer however the run ends — a check that could not run included — so the
// join waiting on it never waits on a check that died.
async function recorded_run(max_hunks: number, token: string): Promise<PinnedReport> {
	try {
		const report = await settled_run(max_hunks)

		test_pinned_record.write(token, test_pinned_record.summary_of(report))

		return report
	} catch (error: unknown) {
		test_pinned_record.write(token, test_pinned_record.not_run_summary(error))

		throw error
	}
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
	const options = options_of(argv)
	if (options === undefined) return print_usage(argv)

	const report =
		options.record_token === undefined
			? await test_pinned.run(options.max_hunks)
			: await recorded_run(options.max_hunks, options.record_token)

	process.stdout.write(test_pinned_logic.report_text(report))

	return report.unpinned.length === 0 ? CLEAN_EXIT : FAILED_EXIT
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(ARGV_OFFSET))
}

const test_pinned_main = { main }

export { test_pinned_main }
