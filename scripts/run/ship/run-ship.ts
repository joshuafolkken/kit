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
	// The paths a stopped merge left unmerged, handed to the stop prompt.
	conflicts?: ReadonlyArray<string>
}

// The step that stopped the ship, or `undefined` when every executed step was green. Because the
// composite breaks at the first failure, this is the last section whenever one exists.
function failed_section(sections: ReadonlyArray<ShipSection>): ShipSection | undefined {
	return sections.find((section) => section.code !== run_section.SUCCESS_EXIT_CODE)
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
}

export type { ShipSection }
export { run_ship }
