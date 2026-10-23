#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cases_interaction_scan, type Findings } from './cases-interaction-scan'
import { cases, type Boundary } from './cases-logic'

// `josh cases <path...>` — print the I/O boundaries the changed paths cross, the shared state and the
// environment they depend on, and the abnormal cases each owes. The tokens go on stdout so
// `$(pnpm josh cases …)` reads them; the required cases go on stderr so a person sees them without a
// shell parsing around them. The logic and the vocabulary live in `cases-logic.ts` and
// `cases-interaction.ts`; everything here is the invocation.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh cases <path...>'
const FAILURE_EXIT_CODE = 1

function report_none(): number {
	console.info(cases.NONE)
	console.error(
		'no network, process, filesystem, time, shared-state or environment boundary crossed',
	)

	return 0
}

// The interaction lines come first, as `report:template` places them at the head of "if it breaks".
function report_crossed(boundaries: ReadonlyArray<Boundary>, findings: Findings): number {
	console.info([...boundaries, ...cases_interaction_scan.interactions_of(findings)].join(' '))

	for (const line of cases_interaction_scan.lines_for(findings)) console.error(line)

	if (boundaries.length > 0) {
		console.error(`required abnormal cases: ${cases.cases_for(boundaries).join(' / ')}`)
	}

	return 0
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length === 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const boundaries = cases.boundaries_in(argv)
	const findings = await cases_interaction_scan.scan(argv)
	const is_crossed = boundaries.length + cases_interaction_scan.interactions_of(findings).length > 0

	return is_crossed ? report_crossed(boundaries, findings) : report_none()
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const cases_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { cases_cli }
