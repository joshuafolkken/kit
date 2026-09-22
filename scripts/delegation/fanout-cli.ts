#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { fanout, type FanoutUnit } from './fanout'

// `josh fanout <unit-files> <unit-files> …` — may the Step 0 change list be cut into file-disjoint
// units and dispatched in one fan-out turn? (joshuafolkken/kit#2345)
//
// A command rather than a paragraph, for the reason `josh delegate` is one: "these units look
// independent" is a judgement made under the same cost pressure, and the answer is mechanical — read
// off the file sets. Each argument is one unit's comma-separated file list; the verdict is on stdout
// so `$(josh fanout …)` reads it, the reason on stderr so a person sees why.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh fanout <unit-files> <unit-files> [<unit-files> …]  (each a comma-separated file list)'

const FILE_SEPARATOR = ','

// One argument to one unit: split on commas, trim, drop the empties a stray comma leaves.
function parse_unit(argument: string): FanoutUnit {
	const files = argument
		.split(FILE_SEPARATOR)
		.map((file) => file.trim())
		.filter((file) => file !== '')

	return { files }
}

// Refused when nothing was passed, or when a unit parses to no files at all — an empty unit says
// nothing about disjointness and is a typo, not a verdict.
function is_refused(units: ReadonlyArray<FanoutUnit>): boolean {
	return units.length === 0 || units.some((unit) => unit.files.length === 0)
}

function run(argv: ReadonlyArray<string>): number {
	const units = argv.map((argument) => parse_unit(argument))

	if (is_refused(units)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = fanout.fanout_result(units)

	console.info(result.verdict)
	console.error(result.reason)

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const fanout_cli = { USAGE, parse_unit, is_refused, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { fanout_cli }
