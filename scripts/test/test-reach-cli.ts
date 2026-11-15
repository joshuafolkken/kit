#!/usr/bin/env tsx
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test_pinned_reach } from './test-pinned-reach'

// `josh test:reach <file...>` — how many test files each file's imports reach, the count
// `josh test:related` sizes its core claim by, one `<count> <file>` line per file
// (joshuafolkken/kit#5238): an overrun filing or a baseline measures it without a hand-written probe.
// `--count <file>` prints that one file's count alone, the number-only last line an Issue's premise
// or measure declaration reads (joshuafolkken/kit#7604).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const COUNT_FLAG = '--count'
const USAGE = 'Usage: josh test:reach <file...> | --count <file>'
const NO_GRAPH =
	'josh test:reach: no import graph can be built here (no typescript or tsconfig.json)'

function is_file(path: string): boolean {
	return existsSync(path) && statSync(path).isFile()
}

// A path no file answers — absent, or a directory — reaches no test, so its `0` would read as a
// measured count: `pnpm josh` runs from the repository root, where a path typed relative to a
// subdirectory names nothing.
function is_count_mode(argv: ReadonlyArray<string>): boolean {
	return argv[0] === COUNT_FLAG
}

function file_arguments(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	return is_count_mode(argv) ? argv.slice(1) : argv
}

// `--count` takes exactly one file: a second count line would leave the last line naming one file.
function is_shape_valid(argv: ReadonlyArray<string>): boolean {
	const { length } = file_arguments(argv)

	return is_count_mode(argv) ? length === 1 : length > 0
}

function refusal(argv: ReadonlyArray<string>): string | undefined {
	if (!is_shape_valid(argv)) return USAGE
	const missing = file_arguments(argv).filter((file) => !is_file(file))
	if (missing.length === 0) return undefined

	return `josh test:reach: no such file from the repository root: ${missing.join(', ')}`
}

function format_counts(
	counts: ReadonlyArray<{ file: string; count: number }>,
	is_count: boolean,
): string {
	if (is_count) return counts.map(({ count }) => String(count)).join('\n')

	return counts.map(({ file, count }) => `${String(count)} ${file}`).join('\n')
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const refused = refusal(argv)

	if (refused !== undefined) {
		console.error(refused)

		return FAILURE_EXIT_CODE
	}

	const counts = await test_pinned_reach.reached_test_counts(file_arguments(argv))

	if (counts === undefined) {
		console.error(NO_GRAPH)

		return FAILURE_EXIT_CODE
	}

	console.info(format_counts(counts, is_count_mode(argv)))

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const test_reach_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { test_reach_cli }
