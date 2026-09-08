import { time_format } from './time-format'
import { time_spans } from './time-spans'

// The three transcript shares and the CI row — the block printed under `Where the wall clock went:`.
//
// It left `time-report.ts` when the CI cycle block took that file past its length limit
// (joshuafolkken/kit#1465): the same move, for the same reason, as `time-phase-table.ts`
// (joshuafolkken/kit#1392) and `time-trips.ts` (joshuafolkken/kit#1385), where a block owns its own
// rendering and the report calls one function per block.
//
// **The facts it reads are declared locally rather than imported from `TimeReport`** — the shape
// `time-trips.ts` already uses. `time-report.ts` imports this module, so reaching back for its type
// would close a cycle and buy nothing. `CategoryTotals` moved here with the block rather than being
// restated on either side, and `time-report.ts` re-exports it under the name it always had.

const { format_row, format_share, unmeasured_row } = time_format
const { MODEL_LABEL, TOOL_LABEL, HUMAN_LABEL, CI_LABEL } = time_format

// `ci_ms` is the fourth share (joshuafolkken/kit#1268): the part of the pull request's
// open→merge window that no transcript span covers. Disjoint from the other three by construction,
// so the four still reconstruct the elapsed time exactly — the property that makes two runs
// comparable, and the one a naive "add the PR window" would have broken, since `followup`
// waits for CI *inside* a tool span that is already counted.
//
// **So the CI a run waited for inside `followup` is in `tool_ms`, and in no other field**
// (joshuafolkken/kit#1406). It is the merge command's own execution, and `ci_ms` deliberately
// excludes it — a hand read that saw the phase table's `ci` row beside a `CI wait 0.0 min` category
// row could take the two for the same quantity and conclude a stretch had gone unmeasured. Nothing
// is: the phase table charges that stretch to `ci` and subtracts it from `merge`
// (`time-phases.ts` → `serial_ci_ms`), which moves it between two *phases* and never between
// categories. `model_ms` is the total duration of every model span, `tool_ms` of every tool span,
// `human_ms` of every human span — each a sum over spans, so no reattribution in the phase table can
// reach them.
interface CategoryTotals {
	model_ms: number
	tool_ms: number
	human_ms: number
	ci_ms: number
}

// What this block reads off the report, and nothing more.
interface CategoryFacts {
	elapsed_ms: number
	span_count: number
	has_ci_data: boolean
	categories: CategoryTotals
}

function ci_line(report: CategoryFacts): Array<string> {
	if (!report.has_ci_data) return []

	const { ci_ms } = report.categories

	return [format_row(CI_LABEL, ci_ms, format_share(ci_ms, report.elapsed_ms))]
}

// **The three transcript shares are withheld together when no span was read** (joshuafolkken/kit#1295).
// A run whose transcript could not be attributed totals zero in all three because nothing was read,
// not because nothing happened — and `CI wait 3.2 min 100.0%` directly beneath three `0.0 min` rows
// reads as a run that spent its whole length in CI. The criterion is `time_spans.has_transcript_data`,
// the same one the epic scope withholds its own category rows on and the `wait` phase is detected on.
function transcript_row(report: CategoryFacts, label: string, duration_ms: number): string {
	if (!time_spans.has_transcript_data(report.span_count)) return unmeasured_row(label)

	return format_row(label, duration_ms, format_share(duration_ms, report.elapsed_ms))
}

function category_lines(report: CategoryFacts): Array<string> {
	const { categories } = report

	return [
		transcript_row(report, MODEL_LABEL, categories.model_ms),
		transcript_row(report, TOOL_LABEL, categories.tool_ms),
		transcript_row(report, HUMAN_LABEL, categories.human_ms),
		...ci_line(report),
	]
}

const time_category_table = {
	category_lines,
}

export type { CategoryFacts, CategoryTotals }
export { time_category_table }
