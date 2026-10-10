// `josh run:tail [<N> ...]` — the one call that closes a run. It folds the fixed
// post-merge bookkeeping that would otherwise take three separate round trips — commit the observation
// ledger (`observations:flush`), read the completion citations (`issue:cite`), and decide whether a
// release is owed (`release:scope`) — into one composite, the same shape `run:prep` bundles three reads
// on. None of the three needs a decision between it and the next, so nothing the reader had to judge is
// folded away; the review verdict, the merge and the push stay their own calls above this.
//
// **This module is the pure half**, kept apart from the chaining CLI the way `run-prep.ts` is. It joins
// each step's output under a header and answers the exit code from the collected codes, so a test pins
// the composite without a ledger ever being committed or a release ever read.

import { run_section, type Section } from './run-section'

const SYNC_HEADER = '=== sync ==='
const OBSERVATIONS_HEADER = '=== observations ==='
const CITATIONS_HEADER = '=== citations ==='
const RELEASE_HEADER = '=== release ==='

type TailSection = Section

// **A failed step's stderr joins its body.** A detached run's log keeps the report, not the
// terminal, so a refusal printed only to stderr would leave the section reading `ELIFECYCLE` alone. A
// passing step's stderr is commentary and stays out of the report.
function section_body(out: string, error_output: string | undefined, code: number): string {
	if (error_output === undefined || code === run_section.SUCCESS_EXIT_CODE) return out

	return [out, error_output].filter((part) => part.length > 0).join('\n')
}

// The exit code is non-zero when any step failed, exactly as each of the three exits on its own — a
// bundle where the ledger commit failed is never read as a clean close because the citations after it
// succeeded.
const run_tail = {
	CITATIONS_HEADER,
	OBSERVATIONS_HEADER,
	RELEASE_HEADER,
	SYNC_HEADER,
	exit_code: run_section.exit_code_of,
	format_report: run_section.format_sections,
	section_body,
}

export type { TailSection }
export { run_tail }
