// `josh ship "<title> #<N>"` — the one call that ships a finished change (joshuafolkken/kit#2398). It
// folds the fixed commit-to-report region a run spent a dozen round trips on — the gate, the
// commit/push/PR (`git -y`), the CI-wait merge (`followup`) and the report bookkeeping (`run:tail`) —
// into one composite, extending the post-merge fold of `run:tail` (joshuafolkken/kit#2372) into the
// body of the region. The region is fixed procedure; the one decision it carried — disposing of a
// review finding — stays in front of this command, so nothing a reader had to judge is folded away.
//
// **This module is the pure half**, kept apart from the chaining CLI the way `run-tail.ts` is. Unlike
// `run:tail`, ship stops at the first failed step: a red gate must never reach the commit, so the
// composite ends at the failure, and the report names the step that failed so the run reads only it.

const REVIEW_HEADER = '=== review ==='
const GATE_HEADER = '=== gate ==='
const COMMIT_HEADER = '=== commit/push/PR ==='
const ROUND_TWO_HEADER = '=== round-2 review ==='
const FOLLOWUP_HEADER = '=== followup ==='
const REPORT_HEADER = '=== report ==='
const SECTION_SEPARATOR = '\n\n'
const STOPPED_PREFIX = 'stopped at: '
// The body of a stage a resumed ship passed over (joshuafolkken/kit#2426) — a success, so the report
// still shows every stage under its header and the reader sees which ones this call did not repeat.
const SKIPPED_BODY = 'skipped — already done'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface ShipSection {
	header: string
	body: string
	code: number
}

function section_report(section: ShipSection): string {
	return `${section.header}\n${section.body}`
}

// The step that stopped the ship, or `undefined` when every executed step was green. Because the
// composite breaks at the first failure, this is the last section whenever one exists.
function failed_section(sections: ReadonlyArray<ShipSection>): ShipSection | undefined {
	return sections.find((section) => section.code !== SUCCESS_EXIT_CODE)
}

// The executed steps under their headers, closed with the name of the step that stopped the run so the
// reader sees which one to fix without counting sections.
function format_report(sections: ReadonlyArray<ShipSection>): string {
	const body = sections.map((section) => section_report(section)).join(SECTION_SEPARATOR)
	const failed = failed_section(sections)

	if (failed === undefined) return body

	return `${body}${SECTION_SEPARATOR}${STOPPED_PREFIX}${failed.header}`
}

// Non-zero when any executed step failed — the composite only ever collects a failed step as its last,
// so this reads the same clean/red verdict as the loop that stopped there.
function exit_code(sections: ReadonlyArray<ShipSection>): number {
	const is_clean = sections.every((section) => section.code === SUCCESS_EXIT_CODE)

	return is_clean ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const run_ship = {
	COMMIT_HEADER,
	FOLLOWUP_HEADER,
	GATE_HEADER,
	REPORT_HEADER,
	REVIEW_HEADER,
	ROUND_TWO_HEADER,
	SKIPPED_BODY,
	STOPPED_PREFIX,
	SUCCESS_EXIT_CODE,
	exit_code,
	failed_section,
	format_report,
}

export type { ShipSection }
export { run_ship }
