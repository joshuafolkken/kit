import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { time_batch, type RunTiming } from './time-batch'
import { time_github, type GhReader } from './time-github'
import { time_instant } from './time-instant'
import type { CategoryTotals } from './time-report'
import { time_spans } from './time-spans'

// A whole `epicrun`, child by child (joshuafolkken/kit#1271).
//
// `--issue` measures one `fullrun`; a batch is several of those, and every slow stage is paid once
// per child. Which child was long, and whether the run got slower as it went, had no answer that did
// not start with running `--issue` by hand for each number in the epic body.
//
// **The per-turn figure is the point of the aggregation, not a decoration.** #1153 measured the
// token side of one context growing — `$0.257` per request on a 463-request run against `$0.108` on
// a 16-request one — and nothing said whether the same growth shows up in *time*. Model wait divided
// by the number of turns is that measurement, read per child and compared across the batch.
//
// **Nothing here re-derives what another module already decides.** The children are enumerated by
// `git-epic-parse.ts`, the one reader of an epic's task list, and each child is measured by
// `time-run.ts` exactly as `--issue` measures it. A second enumeration would disagree with
// `epic:next` about what the batch is; a second measurement would disagree with `--issue` about what
// a run took.

const MIN_TREND_CHILDREN = 2
const NONE = 0
// Sorts a child with no measured start behind every child that has one. `Number.MAX_SAFE_INTEGER`
// rather than `Infinity`, which a subtracting comparator turns into `NaN` when two such children
// meet — and `NaN` makes the whole ordering implementation-defined.
const UNDATED_ORDER_KEY = Number.MAX_SAFE_INTEGER

// **A child's timing is `time-batch.ts`'s, and so is the fan-out that builds it**
// (joshuafolkken/kit#1312). What a run is worth measuring in four states, and how several of them are
// measured at once, are shared with `--last`; what stays here is what makes those rows an *epic* — the
// execution order, the batch totals and the per-turn trend.

// The batch's per-turn direction, read from the first and last child that recorded a turn. Kept as
// two figures rather than a ratio so a reader can see both ends; `is_comparable` is false where
// fewer than two children measured one, because a single point has no direction.
interface EpicTrend {
	is_comparable: boolean
	first_ms_per_turn: number
	last_ms_per_turn: number
	child_count: number
}

interface EpicTimeReport {
	scope: string
	epic_number: number
	// In execution order, which is when each child actually ran — not the order the body lists them.
	children: Array<RunTiming>
	total_ms: number
	categories: CategoryTotals
	// Whether either half was read for *any* child. The batch totals are a sum of what was measured,
	// so a half nobody read totals zero — and a `0.0 min` row asserts a measurement where these two
	// say none was made. The same flag `TimeReport.has_ci_data` already is, one level up.
	has_transcript_data: boolean
	has_ci_data: boolean
	// Three counts rather than one, because "something was measured" and "the whole run was measured"
	// are different facts about a batch and a header that prints only one of them hides the other.
	timed_count: number
	measured_count: number
	unmeasured_count: number
	trend: EpicTrend
	notes: Array<string>
}

const NO_CATEGORIES: CategoryTotals = { model_ms: 0, tool_ms: 0, human_ms: 0, ci_ms: 0 }
const NO_TREND: EpicTrend = {
	is_comparable: false,
	first_ms_per_turn: 0,
	last_ms_per_turn: 0,
	child_count: 0,
}

function order_key(timing: RunTiming): number {
	return time_instant.parse_instant(timing.report.started_at) ?? UNDATED_ORDER_KEY
}

// Execution order is when each child ran, not the order the epic body lists them in: the rows are
// written before the batch starts, a child can be run out of that order, and one that never ran has
// no place in it at all. `toSorted` is stable, so the children with no measured start keep the
// body's order behind the rest rather than being shuffled.
function in_execution_order(rows: ReadonlyArray<RunTiming>): Array<RunTiming> {
	return rows.toSorted((left, right) => order_key(left) - order_key(right))
}

function add_categories(left: CategoryTotals, right: CategoryTotals): CategoryTotals {
	return {
		model_ms: left.model_ms + right.model_ms,
		tool_ms: left.tool_ms + right.tool_ms,
		human_ms: left.human_ms + right.human_ms,
		ci_ms: left.ci_ms + right.ci_ms,
	}
}

// The batch's shares, summed from the children's. A child that was never run contributes zeroes
// because it has no spans, which is arithmetic rather than an assertion — the row above still says
// `not run` rather than `0.0 min`.
function total_categories(rows: ReadonlyArray<RunTiming>): CategoryTotals {
	let totals = NO_CATEGORIES

	for (const row of rows) totals = add_categories(totals, row.report.categories)

	return totals
}

function total_elapsed_ms(rows: ReadonlyArray<RunTiming>): number {
	let total = NONE

	for (const row of rows) total += row.report.elapsed_ms

	return total
}

function per_turn_rates(rows: ReadonlyArray<RunTiming>): Array<number> {
	return rows
		.map((row) => row.ms_per_turn)
		.filter((rate): rate is number => rate !== undefined && rate > NONE)
}

// Whether model wait per turn rises as the batch goes on — the time-side counterpart of the
// per-request cost growth #1153 measured on the token side.
function trend_of(rows: ReadonlyArray<RunTiming>): EpicTrend {
	const rates = per_turn_rates(rows)
	const [first] = rates
	const last = rates.at(-1)

	if (first === undefined || last === undefined || rates.length < MIN_TREND_CHILDREN) {
		return { ...NO_TREND, child_count: rates.length }
	}

	return {
		is_comparable: true,
		first_ms_per_turn: first,
		last_ms_per_turn: last,
		child_count: rates.length,
	}
}

// A count of nothing is not a note, and the guard is `time-batch.ts`'s so both batch scopes phrase
// the same exclusion the same way (joshuafolkken/kit#1312). The unit is this scope's own word.
function count_note(count: number, tail: string): Array<string> {
	return time_batch.count_note(count, 'child(ren)', tail)
}

function notes_of(rows: ReadonlyArray<RunTiming>, external_count: number): Array<string> {
	return [
		...count_note(external_count, 'live in another repository and are not measured here'),
		// "nothing was measured", not "nothing happened": `not run` covers a child the batch never
		// reached *and* one whose pull request could not be read at all, and each row carries its own
		// note saying which. A count asserting the first would report a rate-limited `gh` as an idle
		// batch.
		...count_note(
			time_batch.count_status(rows, time_batch.NOT_RUN),
			'have nothing measured and are reported as "not run" — each row says why',
		),
		// Separate from the count above, and never folded into it: that one is about children with
		// nothing to measure, this one about a measurement that broke. A batch reporting the second as
		// the first is what let a regression print a plausible table and exit 0
		// (joshuafolkken/kit#1352).
		...count_note(time_batch.count_status(rows, time_batch.FAILED), time_batch.FAILED_NOTE_TAIL),
		...count_note(
			time_batch.count_status(rows, time_batch.NO_TRANSCRIPT),
			'merged with no session transcript attributed, so only their CI wait is known',
		),
		...count_note(
			time_batch.count_status(rows, time_batch.NOT_MERGED),
			'never merged, so their time is only what was measured so far',
		),
	]
}

// What the epic body tracks. The bare numbers are the children measured here; the qualified rows
// are counted only, because a child in another repository is measured from that repository's own
// transcripts and pull requests.
interface EpicChildren {
	numbers: ReadonlyArray<number>
	external_count: number
}

// `undefined` is a read that failed, which the caller reports in words. An epic whose body tracks no
// children answers with an empty list instead — "the epic tracks nothing" and "nobody could read the
// epic" are different answers, and only the second is a failure.
async function read_children(
	epic_number: number,
	read: GhReader,
): Promise<EpicChildren | undefined> {
	const body = await time_github.read_issue_body(epic_number, read)

	if (body === undefined) return undefined

	return {
		numbers: git_epic_parse.parse_task_list_issue_numbers(body),
		external_count: git_epic_parse.parse_external_task_list_children(body).length,
	}
}

// The children are measured by `time_batch.build_timings` — the fan-out `--last` shares, so the two
// scopes cannot come to disagree about what a run took (joshuafolkken/kit#1312). `searches` is
// `undefined` because an epic starts from issue numbers alone and the pull-request listing is what
// resolves them; `--last` selected its runs from that listing and hands over what it already read.
async function build_children(
	numbers: ReadonlyArray<number>,
	cwd: string,
	read: GhReader,
): Promise<Array<RunTiming>> {
	return await time_batch.build_timings({ numbers, cwd, read, searches: undefined })
}

function to_epic_report(
	epic_number: number,
	rows: ReadonlyArray<RunTiming>,
	external_count: number,
): EpicTimeReport {
	const ordered = in_execution_order(rows)

	return {
		scope: `epic #${String(epic_number)}`,
		epic_number,
		children: ordered,
		total_ms: total_elapsed_ms(ordered),
		categories: total_categories(ordered),
		has_transcript_data: ordered.some((row) =>
			time_spans.has_transcript_data(row.report.span_count),
		),
		has_ci_data: ordered.some((row) => row.report.has_ci_data),
		// A child whose report failed to build is no more timed than one the batch never reached, so
		// both counts ask `count_untimed` rather than naming `not run` alone.
		timed_count: ordered.length - time_batch.count_untimed(ordered),
		measured_count: time_batch.count_status(ordered, time_batch.MEASURED),
		unmeasured_count: time_batch.count_untimed(ordered),
		trend: trend_of(ordered),
		notes: notes_of(ordered, external_count),
	}
}

// One epic's whole batch. `undefined` means the epic itself could not be read, which is the only
// failure: a child with no run, no merge or no transcript is reported as such rather than dropped.
async function build_epic_report(
	epic_number: number,
	cwd: string,
	read: GhReader = time_github.read_gh,
): Promise<EpicTimeReport | undefined> {
	const found = await read_children(epic_number, read)

	if (found === undefined) return undefined

	return to_epic_report(
		epic_number,
		await build_children(found.numbers, cwd, read),
		found.external_count,
	)
}

const time_epic = {
	MIN_TREND_CHILDREN,
	in_execution_order,
	total_categories,
	trend_of,
	read_children,
	build_epic_report,
}

export type { EpicChildren, EpicTimeReport, EpicTrend }
export { time_epic }
