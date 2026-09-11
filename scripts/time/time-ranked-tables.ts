import { time_checks, type CheckTotal } from './time-checks'
import { time_format } from './time-format'
import { time_invocations, type InvocationTotal } from './time-invocations'
import type { LabelTotal, RowTotal, ToolTotal } from './time-report'

// The page's closing half: the tables that rank an open set of rows, largest first
// (joshuafolkken/kit#1445, moved here by joshuafolkken/kit#1786).
//
// It was `time-report.ts`'s until that file passed its length limit again — the same seam
// `time-trips.ts`, `time-bundles.ts` and `time-failures.ts` were cut along, and the shape all three
// already have: a block owns its own rendering, and `time-report.ts` calls one function per block.
// What stayed behind is the aggregation, which is what every other caller of that file reads.
//
// **The split is along the seam the page already has** — every block above it is about the run's own
// shape, every one here ranks a list — so the order of the printed page is still the order of two
// lists read one after the other.
//
// **The rows are taken structurally rather than as a `TimeReport`.** The four lists are all this
// needs, and naming them is what keeps the module from importing the very report it is rendering a
// part of; the report satisfies the shape without being named by it.

// What the per-tool and per-`josh <cmd>` tables put in their third column: how many calls the row
// totals. The check table answers something else entirely, which is why the column is a parameter.
function call_suffix(row: LabelTotal): string {
	return `${String(row.call_count)} call(s)`
}

// **What the per-tool table says that the per-`josh <cmd>` table does not** (joshuafolkken/kit#1385):
// the round trips this tool consumed, and how many of its calls were the only call in their turn. A
// row reading `40 call(s) · 40 round trip(s) · 40 alone` names the tool to batch, which is the sentence
// the density one block above could never produce.
function tool_suffix(row: ToolTotal): string {
	const trips = `${String(row.round_trip_count)} round trip(s)`
	const alone = `${String(row.alone_in_turn_count)} alone`

	return [call_suffix(row), trips, alone].join(time_format.SUFFIX_SEPARATOR)
}

function total_lines<Row extends RowTotal>(
	heading: string,
	rows: ReadonlyArray<Row>,
	suffix_of: (row: Row) => string,
): Array<string> {
	if (rows.length === 0) return []

	const shown = rows
		.slice(0, time_format.MAX_ROWS)
		.map((row) => time_format.format_row(row.label, row.duration_ms, suffix_of(row)))

	return ['', heading, ...shown, ...time_format.overflow_line(rows.length)]
}

// The four ranked lists a report carries. Structural on purpose — see the note at the top.
interface RankedSource {
	by_tool: ReadonlyArray<ToolTotal>
	by_josh_command: ReadonlyArray<LabelTotal>
	by_invocation: ReadonlyArray<InvocationTotal>
	by_check: ReadonlyArray<CheckTotal>
}

function ranked_tables(source: RankedSource): Array<string> {
	return [
		...total_lines('By tool (descending):', source.by_tool, tool_suffix),
		...total_lines('By josh command (descending):', source.by_josh_command, call_suffix),
		...time_invocations.invocation_lines(source.by_invocation),
		...total_lines(time_checks.CHECK_HEADING, source.by_check, time_checks.check_suffix),
		...time_checks.merge_wait_lines(source.by_check),
	]
}

const time_ranked_tables = { call_suffix, ranked_tables, tool_suffix, total_lines }

export type { RankedSource }
export { time_ranked_tables }
