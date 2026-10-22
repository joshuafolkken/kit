// `josh ship "<title> #<N>"` — the one call that ships a finished change. It folds the fixed
// commit-to-report region — the gate, the commit/push/PR (`git -y`), the CI-wait merge (`followup`)
// and the report bookkeeping (`run:tail`) — into one composite, extending the post-merge fold of
// `run:tail` into the body of the region. The region is fixed procedure; the one decision it
// carried — disposing of a review finding — stays in front of this command, so nothing a reader had
// to judge is folded away.
//
// **This module is the pure half**, kept apart from the chaining CLI the way `run-tail.ts` is. Unlike
// `run:tail`, ship stops at the first failed step: a red gate must never reach the commit, so the
// composite ends at the failure, and the report names the step that failed so the run reads only it.

import { run_section, type Section } from '#scripts/run/run-section'
import { run_tail } from '#scripts/run/run-tail'
import type { Cause } from './run-ship-stop-cause'
import type { StepResult } from './run-ship-sync'

const PREFLIGHT_HEADER = '=== preflight ==='
const PRE_DETACH_HEADER = '=== pre-detach checks ==='
const REVIEW_HEADER = '=== review ==='
const GATE_HEADER = '=== gate ==='
const SYNC_HEADER = '=== sync origin/main ==='
const COMMIT_HEADER = '=== commit/push/PR ==='
const ROUND_TWO_HEADER = '=== round-2 review ==='
const FOLLOWUP_HEADER = '=== followup ==='
const REPORT_HEADER = '=== report ==='
const STOPPED_PREFIX = 'stopped at: '
// The body of a stage a resumed ship passed over — a success, so the report
// still shows every stage under its header and the reader sees which ones this call did not repeat.
const SKIPPED_BODY = 'skipped — already done'

type ShipSection = Section & {
	// The stage's standard output alone, the text an infrastructure stop is read on.
	out?: string
	// The paths a stopped merge left unmerged, handed to the stop prompt.
	conflicts?: ReadonlyArray<string>
	// The kinds of the preconditions a stopped preflight found unmet, recorded with the stop.
	preconditions?: ReadonlyArray<string>
	// The cause a stopped review round tagged its stop with, recorded with the stop.
	cause?: Cause
}

// A stage's result under its header, carrying the conflicts, the preconditions and the cause only where
// it has them.
function section_of(header: string, result: StepResult): ShipSection {
	const { conflicts, preconditions, cause } = result

	return {
		header,
		body: run_tail.section_body(result.out, result.err, result.code),
		code: result.code,
		out: result.out,
		...(conflicts !== undefined && { conflicts }),
		...(preconditions !== undefined && { preconditions }),
		...(cause !== undefined && { cause }),
	}
}

// The step that stopped the ship, or `undefined` when every executed step was green. Because the
// composite breaks at the first failure, this is the last section whenever one exists. The pre-detach
// report runs on past a red check and prints the preflight refusal last (joshuafolkken/kit#4478), so
// the last failed section is the one named.
function failed_section(sections: ReadonlyArray<ShipSection>): ShipSection | undefined {
	return sections.findLast((section) => section.code !== run_section.SUCCESS_EXIT_CODE)
}

// The executed steps under their headers, closed with the name of the step that stopped the run so the
// reader sees which one to fix without counting sections.
function format_report(sections: ReadonlyArray<ShipSection>): string {
	const body = run_section.format_sections(sections)
	const failed = failed_section(sections)

	if (failed === undefined) return body

	return `${body}${run_section.SECTION_SEPARATOR}${STOPPED_PREFIX}${failed.header}`
}

// The exit code is non-zero when any executed step failed — the composite only ever collects a failed
// step as its last, so it reads the same clean/red verdict as the loop that stopped there.
const run_ship = {
	COMMIT_HEADER,
	FOLLOWUP_HEADER,
	GATE_HEADER,
	PREFLIGHT_HEADER,
	PRE_DETACH_HEADER,
	REPORT_HEADER,
	REVIEW_HEADER,
	ROUND_TWO_HEADER,
	SKIPPED_BODY,
	SYNC_HEADER,
	STOPPED_PREFIX,
	exit_code: run_section.exit_code_of,
	failed_section,
	format_report,
	section_of,
}

export type { ShipSection }
export { run_ship }
