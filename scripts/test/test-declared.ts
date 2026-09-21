#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { test_declared_changed } from './test-declared-changed'
import { test_declared_logic, type Verdict } from './test-declared-logic'
import { test_declared_match, type MatchResult } from './test-declared-match'
import { test_type_logic } from './test-type-logic'

// `josh test:declared` — prints one of `required` / `exempt` / `satisfied` to stdout from the
// working-tree diff, with the reason on stderr (joshuafolkken/kit#2118). The verdict is
// `test-declared-logic.ts`, the tree read is `test-declared-changed.ts`. This command is the way a
// person confirms the same answer by hand; the refusal itself is delivered by the `test-declared` row
// of `delivered-rules.ts` at the commit stage.
//
// `--match` reads a Step 0 work summary on stdin and checks each declared `Test: <type> — <path>`
// line against the change set, printing `match` / `type-mismatch` / `path-missing` /
// `test-not-created` per line and exiting non-zero on any mismatch (joshuafolkken/kit#2181).

const CLEAN_EXIT = 0
const MISMATCH_EXIT = 1
const MATCH_STATUS = 'match'
const ARGV_OFFSET = 2
const NO_DECLARATIONS =
	'no Test: declarations parsed from stdin — pipe the Step 0 work summary in, e.g. `pnpm josh test:declared --match < summary.md`'

// **An unknown flag is a refusal, not a default** — `scripts/time/time-cli.ts` states the same
// convention (joshuafolkken/kit#2297). Ignoring `--foo` and re-printing the verdict is what sent a
// reader off to read the source by hand, so a misspelled or retired flag stops here with the usage.
const PARSE_ARGS_OPTIONS = {
	help: { type: 'boolean', short: 'h', default: false },
	match: { type: 'boolean', default: false },
} as const

const USAGE = [
	'Usage: josh test:declared [--match] [--help]',
	'  (no flags)  print required | exempt | satisfied for the working-tree diff',
	'  --match     read a Step 0 work summary on stdin and check each `Test:` line against the',
	'              change set, e.g. `pnpm josh test:declared --match < summary.md`',
	'  --help, -h  print this usage',
].join('\n')

// The one command a `required` verdict leaves to run next: declare a test for each named runtime file,
// then verify the declarations against the change set (joshuafolkken/kit#2297). Printed after the
// detail so the verdict-to-detail mapping the report test pins stays untouched.
const NEXT_STEP =
	'next: declare a test for each runtime file above, then verify with `pnpm josh test:declared --match < summary.md`'

interface Options {
	is_help: boolean
	is_match: boolean
}

// The parsed flags, or `undefined` when an unknown one was passed — the strict parse is what turns a
// typo into a refusal rather than a silent re-print of the verdict.
function parse(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return { is_help: values.help, is_match: values.match }
	} catch {
		return undefined
	}
}

// The next command a verdict leaves to run, or `undefined` when there is nothing to do next. Only
// `required` owes one — an untested runtime change is the one verdict a person acts on.
function next_step(verdict: Verdict): string | undefined {
	return verdict === 'required' ? NEXT_STEP : undefined
}

// A runtime file with the test type its path calls for, so the required detail says which kind of
// test to add rather than only that one is missing (joshuafolkken/kit#2181).
function typed_runtime_file(path: string): string {
	return `${test_type_logic.test_type_for(path)} — ${path}`
}

// The word is stdout so a caller can read it alone; the reason — which files, and why — is stderr.
function detail_for(verdict: Verdict, paths: ReadonlyArray<string>): string {
	if (verdict === 'required') {
		const typed = test_declared_logic.runtime_files(paths).map((path) => typed_runtime_file(path))

		return `runtime files with no test: ${typed.join(', ')}`
	}

	if (verdict === 'exempt') {
		return `exempt paths: ${test_declared_logic.exempt_files(paths).join(', ')}`
	}

	return 'a test file changed'
}

function report(paths: ReadonlyArray<string>): { detail: string; verdict: Verdict } {
	const verdict = test_declared_logic.verdict_for(paths)

	return { detail: detail_for(verdict, paths), verdict }
}

function run(): void {
	const { detail, verdict } = report(test_declared_changed.read_changed_paths_sync())

	process.stdout.write(`${verdict}\n`)
	process.stderr.write(`${detail}\n`)

	const next = next_step(verdict)

	if (next !== undefined) process.stderr.write(`${next}\n`)
}

function format_match(result: MatchResult): string {
	return `${result.status}: ${result.declared_type} — ${result.path}`
}

// The exit code the match run leaves: clean only when every declaration matched, so it gates. A
// summary that parses to no declarations is a mismatch, not a pass — a forgotten pipe would otherwise
// read as "all declarations satisfied" when nothing was checked at all.
function run_match(summary: string, changed: ReadonlyArray<string>): number {
	const results = test_declared_match.match_report(summary, changed)

	if (results.length === 0) {
		process.stderr.write(`${NO_DECLARATIONS}\n`)

		return MISMATCH_EXIT
	}

	for (const result of results) process.stdout.write(`${format_match(result)}\n`)

	return results.every((result) => result.status === MATCH_STATUS) ? CLEAN_EXIT : MISMATCH_EXIT
}

// Prints the usage and returns the exit code: clean for an explicit `--help`, a mismatch for an
// unknown flag — the flag was not understood, so the verdict must not be re-printed as though it were.
function print_usage(is_help: boolean): number {
	if (is_help) {
		process.stdout.write(`${USAGE}\n`)

		return CLEAN_EXIT
	}

	process.stderr.write(`${USAGE}\n`)

	return MISMATCH_EXIT
}

// Returns the exit code so the entry point assigns `process.exitCode` in one expression — an unknown
// flag prints the usage and gates, `--help` prints it clean, the default verdict path prints and
// returns clean, and the match path reads stdin and gates on the result.
async function main(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse(argv)

	if (options === undefined) return print_usage(false)
	if (options.is_help) return print_usage(true)

	if (!options.is_match) {
		run()

		return CLEAN_EXIT
	}

	const summary = process.stdin.isTTY ? '' : await text(process.stdin)

	return run_match(summary, test_declared_changed.read_changed_paths_sync())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(ARGV_OFFSET))
}

const test_declared = {
	USAGE,
	detail_for,
	format_match,
	next_step,
	parse,
	report,
	run,
	run_match,
}

export { test_declared }
