#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { cli_flags } from '#scripts/lib/cli-flags'
import { report_format_reference } from '#scripts/report/report-format-reference'
import { test_declared_changed } from './test-declared-changed'
import { test_declared_logic, type Verdict } from './test-declared-logic'
import { test_declared_match, type MatchResult } from './test-declared-match'
import { test_type_logic } from './test-type-logic'

// `josh test:declared` — prints one of `required` / `exempt` / `satisfied` to stdout from the
// working-tree diff, with the reason on stderr. The verdict is
// `test-declared-logic.ts`, the tree read is `test-declared-changed.ts`. This command is the way a
// person confirms the same answer by hand; the refusal itself is delivered by the `test-declared` row
// of `delivered-rules.ts` at the commit stage.
//
// `--match` reads a Step 0 work summary on stdin and checks each declared `Test: <type> — <path>`
// line against the change set, printing `match` / `type-mismatch` / `path-missing` /
// `test-not-created` per line and exiting non-zero on any mismatch.

const CLEAN_EXIT = 0
const MISMATCH_EXIT = 1
const MATCH_STATUS = 'match'
const PATH_MISSING_STATUS = 'path-missing'
const ARGV_OFFSET = 2
const NO_DECLARATIONS =
	'no Test: declarations parsed from stdin — pipe the Step 0 work summary in, e.g. `pnpm josh test:declared --match < summary.md`'

// **An unknown flag is a refusal, not a default** — `scripts/time/time-cli.ts` states the same
// convention. Ignoring `--foo` and re-printing the verdict is what sent a
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
// then verify the declarations against the change set. Printed after the
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
	const values = cli_flags.values_of(argv, PARSE_ARGS_OPTIONS)

	return values === undefined ? undefined : { is_help: values.help, is_match: values.match }
}

// The next command a verdict leaves to run, or `undefined` when there is nothing to do next. Only
// `required` owes one — an untested runtime change is the one verdict a person acts on.
function next_step(verdict: Verdict): string | undefined {
	return verdict === 'required' ? NEXT_STEP : undefined
}

// A runtime file with the test type its path calls for, so the required detail says which kind of
// test to add rather than only that one is missing.
function typed_runtime_file(path: string): string {
	return `${test_type_logic.test_type_for(path)} — ${path}`
}

const BROWSER_CHECK = 'confirm the rendered page in a browser'
const RUN_CHECK = 'run the changed code by hand and report what you observed'

// The manual confirmation a basic-profile exemption owes, one instruction per kind of file it covers:
// HTML/CSS is looked at in a browser, a source kit cannot test is run by hand.
function manual_instruction(paths: ReadonlyArray<string>, is_basic: boolean): string {
	const manual = test_declared_logic.manual_check_files(paths, is_basic)
	const has_visual = manual.some((path) => test_declared_logic.is_basic_visual(path))
	const has_source = manual.some((path) => !test_declared_logic.is_basic_visual(path))
	const steps = [has_visual ? BROWSER_CHECK : '', has_source ? RUN_CHECK : ''].filter(Boolean)

	return steps.length === 0 ? '' : ` — ${steps.join('; ')}`
}

// The word is stdout so a caller can read it alone; the reason — which files, and why — is stderr.
function exempt_detail(paths: ReadonlyArray<string>, is_basic: boolean): string {
	const exempt = test_declared_logic.exempt_files(paths, is_basic)

	return `exempt paths: ${exempt.join(', ')}${manual_instruction(paths, is_basic)}`
}

function detail_for(verdict: Verdict, paths: ReadonlyArray<string>, is_basic = false): string {
	if (verdict === 'required') {
		const typed = test_declared_logic
			.runtime_files(paths, is_basic)
			.map((path) => typed_runtime_file(path))

		return `runtime files with no test: ${typed.join(', ')}`
	}

	if (verdict === 'exempt') return exempt_detail(paths, is_basic)

	return 'a test file changed'
}

function report(
	paths: ReadonlyArray<string>,
	is_basic: boolean = project_checks.is_basic(process.cwd()),
): { detail: string; verdict: Verdict } {
	const verdict = test_declared_logic.verdict_for(paths, is_basic)

	return { detail: detail_for(verdict, paths, is_basic), verdict }
}

function run(): void {
	const { detail, verdict } = report(test_declared_changed.read_changed_paths_sync())

	process.stdout.write(`${verdict}\n`)
	process.stderr.write(`${detail}\n`)

	const next = next_step(verdict)

	if (next !== undefined) process.stderr.write(`${next}\n`)
}

// A `path-missing` line names the changed paths it probably meant and where the declaration's shape is
// written, so the summary is fixed without reading this command's source.
function path_missing_hints(path: string, changed: ReadonlyArray<string>): ReadonlyArray<string> {
	const candidates = test_declared_match.path_candidates(path, changed)
	const shape = `  the declaration line's shape: ${report_format_reference.pointer(report_format_reference.SUMMARY_RULES_HEADING)}`

	if (candidates.length === 0) return [shape]

	return [`  changed with the same file name: ${candidates.join(', ')}`, shape]
}

function format_match(result: MatchResult, changed: ReadonlyArray<string> = []): string {
	const line = `${result.status}: ${result.declared_type} — ${result.path}`

	if (result.status !== PATH_MISSING_STATUS) return line

	return [line, ...path_missing_hints(result.path, changed)].join('\n')
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

	for (const result of results) process.stdout.write(`${format_match(result, changed)}\n`)

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
	format_match,
	next_step,
	parse,
	report,
	run_match,
}

export { test_declared }
