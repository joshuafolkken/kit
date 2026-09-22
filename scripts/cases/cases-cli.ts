#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cases, type Boundary } from './cases-logic'

// `josh cases <path...>` — print the I/O boundaries the changed paths cross and the abnormal cases
// each owes (joshuafolkken/kit#2246). The boundary tokens go on stdout so `$(pnpm josh cases …)` reads
// them; the required cases go on stderr so a person sees them without a shell parsing around them.
// The logic and the vocabulary live in `cases-logic.ts`; everything here is the invocation.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh cases <path...>'
const FAILURE_EXIT_CODE = 1

function report_none(): number {
	console.info(cases.NONE)
	console.error('no network, process, filesystem or time boundary crossed')

	return 0
}

function report_boundaries(boundaries: ReadonlyArray<Boundary>): number {
	console.info(boundaries.join(' '))
	console.error(`required abnormal cases: ${cases.cases_for(boundaries).join(' / ')}`)

	return 0
}

function run(argv: ReadonlyArray<string>): number {
	if (argv.length === 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const boundaries = cases.boundaries_in(argv)

	return boundaries.length === 0 ? report_none() : report_boundaries(boundaries)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const cases_cli = { USAGE, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { cases_cli }
