#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
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

const MATCH_FLAG = '--match'
const CLEAN_EXIT = 0
const MISMATCH_EXIT = 1
const MATCH_STATUS = 'match'
const ARGV_OFFSET = 2
const NO_DECLARATIONS =
	'no Test: declarations parsed from stdin — pipe the Step 0 work summary in, e.g. `pnpm josh test:declared --match < summary.md`'

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

// Returns the exit code so the entry point assigns `process.exitCode` in one expression — the default
// verdict path prints and returns clean, the match path reads stdin and gates on the result.
async function main(argv: ReadonlyArray<string>): Promise<number> {
	if (!argv.includes(MATCH_FLAG)) {
		run()

		return CLEAN_EXIT
	}

	const summary = process.stdin.isTTY ? '' : await text(process.stdin)

	return run_match(summary, test_declared_changed.read_changed_paths_sync())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(ARGV_OFFSET))
}

const test_declared = { detail_for, format_match, report, run, run_match }

export { test_declared }
