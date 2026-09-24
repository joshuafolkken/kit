// `josh run:tail [<N> ...]` — the one call that closes a run (joshuafolkken/kit#2372). It folds the
// fixed post-merge bookkeeping a lane spends three separate round trips on — commit the observation
// ledger (`observations:flush`), read the completion citations (`issue:cite`), and decide whether a
// release is owed (`release:scope`) — into one composite, the same shape `run:prep` bundles three reads
// on. None of the three needs a decision between it and the next, so nothing the reader had to judge is
// folded away; the review verdict, the merge and the push stay their own calls above this.
//
// **This module is the pure half**, kept apart from the chaining CLI the way `run-prep.ts` is. It joins
// each step's output under a header and answers the exit code from the collected codes, so a test pins
// the composite without a ledger ever being committed or a release ever read.

const OBSERVATIONS_HEADER = '=== observations ==='
const CITATIONS_HEADER = '=== citations ==='
const RELEASE_HEADER = '=== release ==='
const SECTION_SEPARATOR = '\n\n'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface TailSection {
	header: string
	body: string
	code: number
}

function section_report(section: TailSection): string {
	return `${section.header}\n${section.body}`
}

function format_report(sections: ReadonlyArray<TailSection>): string {
	return sections.map((section) => section_report(section)).join(SECTION_SEPARATOR)
}

// **A failed step's stderr joins its body** (joshuafolkken/kit#2462). A detached run's log keeps the
// report, not the terminal, so a refusal printed only to stderr left the section reading
// `ELIFECYCLE` alone. A passing step's stderr is commentary and stays out of the report.
function section_body(out: string, error_output: string | undefined, code: number): string {
	if (code === SUCCESS_EXIT_CODE || error_output === undefined) return out

	return [out, error_output].filter((part) => part.length > 0).join('\n')
}

// Non-zero when any step failed, exactly as each of the three exits on its own — a bundle where the
// ledger commit failed is never read as a clean close because the citations after it succeeded.
function exit_code(sections: ReadonlyArray<TailSection>): number {
	const is_clean = sections.every((section) => section.code === SUCCESS_EXIT_CODE)

	return is_clean ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const run_tail = {
	CITATIONS_HEADER,
	OBSERVATIONS_HEADER,
	RELEASE_HEADER,
	exit_code,
	format_report,
	section_body,
}

export type { TailSection }
export { run_tail }
