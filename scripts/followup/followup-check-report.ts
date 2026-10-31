import {
	CODERABBIT_CHECK_NAME,
	is_required_check,
	matches_any,
} from '#scripts/gh/git-pr-checks-eval'
import { CHECK_STATUS_FAIL, type PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'

// The completion notification's check report, drafted by `followup` itself rather than retyped into
// `--notify-message` from the printed check list (joshuafolkken/kit#5545): one line per check that
// failed on the merged head, ran again as flaky, or was a rate-limited CodeRabbit review retriggered.
// A run with nothing to report answers no line at all, header included, so the ordinary
// completion report is unchanged.
const REPORT_HEADER = 'Checks:'

interface CheckReportInput {
	snapshot: PrStateSnapshot | undefined
	reran: ReadonlyArray<string>
	is_retriggered: boolean
}

// Required when the gate's own list or the base branch's required contexts name it — the same two
// sources the merge gate reads, so the report and the gate cannot disagree.
function is_required(snapshot: PrStateSnapshot, name: string): boolean {
	return is_required_check(name) || matches_any(name, snapshot.required_contexts ?? [])
}

function failed_lines(snapshot: PrStateSnapshot | undefined): Array<string> {
	if (snapshot === undefined) return []

	return snapshot.rollup
		.filter((check) => check.status === CHECK_STATUS_FAIL)
		.map((check) => {
			const scope = is_required(snapshot, check.name) ? 'required' : 'not required'

			return `- ${check.name} — failed (${scope})`
		})
}

function reran_lines(reran: ReadonlyArray<string>): Array<string> {
	return reran.map((name) => `- ${name} — re-run once, judged flaky; green on the re-run`)
}

function retrigger_lines(is_retriggered: boolean): Array<string> {
	if (!is_retriggered) return []

	return [`- ${CODERABBIT_CHECK_NAME} — rate limited; review retriggered`]
}

function lines(input: CheckReportInput): Array<string> {
	const check_lines = [
		...failed_lines(input.snapshot),
		...reran_lines(input.reran),
		...retrigger_lines(input.is_retriggered),
	]
	if (check_lines.length === 0) return []

	return [REPORT_HEADER, ...check_lines]
}

const followup_check_report = {
	lines,
}

export { followup_check_report }
export type { CheckReportInput }
