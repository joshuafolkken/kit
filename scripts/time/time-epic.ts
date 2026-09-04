import { bounded_pool } from '#scripts/bounded-pool'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { time_corpus } from './time-corpus'
import { time_github, type GhReader } from './time-github'
import { time_instant } from './time-instant'
import { time_pull_index } from './time-pull-index'
import { time_report, type CategoryTotals, type TimeReport } from './time-report'
import { time_run, type RunSources } from './time-run'
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
const NO_TURNS = 0
const NONE = 0
// Sorts a child with no measured start behind every child that has one. `Number.MAX_SAFE_INTEGER`
// rather than `Infinity`, which a subtracting comparator turns into `NaN` when two such children
// meet — and `NaN` makes the whole ordering implementation-defined.
const UNDATED_ORDER_KEY = Number.MAX_SAFE_INTEGER

// What was known about a child's run, in four states rather than two.
//
// **None of the three that are not `measured` is a duration of zero.** A child the batch never
// reached, one whose pull request never merged, and one that merged with no session transcript
// attributed to it are three different answers, and every one of them prints as `0.0 min` if the
// status does not keep them apart. The third is the one measured on epic #1272 itself: four children
// merged, each with a real CI wait, and not one line of transcript attributed to any of them — a
// row reading `model 0.0 min` would have asserted a measurement nobody made.
type ChildStatus = 'measured' | 'no transcript' | 'not merged' | 'not run'

const MEASURED: ChildStatus = 'measured'
const NO_TRANSCRIPT: ChildStatus = 'no transcript'
const NOT_MERGED: ChildStatus = 'not merged'
const NOT_RUN: ChildStatus = 'not run'

interface ChildTiming {
	issue_number: number
	status: ChildStatus
	// Model wait divided by the turns it was spread over, or `undefined` where the run recorded no
	// turn at all — never `0`, which reads as an instant answer rather than as nothing measured.
	ms_per_turn: number | undefined
	// The child's whole report, breakdown included, so `--json` carries per child exactly what
	// `--issue` carries for one run.
	report: TimeReport
}

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
	children: Array<ChildTiming>
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

// `has_ci_data` is whether a merge was actually read and `span_count` whether any transcript was
// attributed. The two are independent, so both are asked: a merge with no transcript knows only the
// CI wait, a transcript with no merge is a run that did not finish, and neither is a child that was
// never started here.
function status_of(report: TimeReport): ChildStatus {
	const has_spans = time_spans.has_transcript_data(report.span_count)

	if (report.has_ci_data) return has_spans ? MEASURED : NO_TRANSCRIPT

	return has_spans ? NOT_MERGED : NOT_RUN
}

function ms_per_turn_of(report: TimeReport): number | undefined {
	if (report.turn_count === NO_TURNS) return undefined

	return report.categories.model_ms / report.turn_count
}

function to_timing(issue_number: number, report: TimeReport): ChildTiming {
	return {
		issue_number,
		status: status_of(report),
		ms_per_turn: ms_per_turn_of(report),
		report,
	}
}

function order_key(timing: ChildTiming): number {
	return time_instant.parse_instant(timing.report.started_at) ?? UNDATED_ORDER_KEY
}

// Execution order is when each child ran, not the order the epic body lists them in: the rows are
// written before the batch starts, a child can be run out of that order, and one that never ran has
// no place in it at all. `toSorted` is stable, so the children with no measured start keep the
// body's order behind the rest rather than being shuffled.
function in_execution_order(rows: ReadonlyArray<ChildTiming>): Array<ChildTiming> {
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
function total_categories(rows: ReadonlyArray<ChildTiming>): CategoryTotals {
	let totals = NO_CATEGORIES

	for (const row of rows) totals = add_categories(totals, row.report.categories)

	return totals
}

function total_elapsed_ms(rows: ReadonlyArray<ChildTiming>): number {
	let total = NONE

	for (const row of rows) total += row.report.elapsed_ms

	return total
}

function count_status(rows: ReadonlyArray<ChildTiming>, status: ChildStatus): number {
	return rows.filter((row) => row.status === status).length
}

function per_turn_rates(rows: ReadonlyArray<ChildTiming>): Array<number> {
	return rows
		.map((row) => row.ms_per_turn)
		.filter((rate): rate is number => rate !== undefined && rate > NONE)
}

// Whether model wait per turn rises as the batch goes on — the time-side counterpart of the
// per-request cost growth #1153 measured on the token side.
function trend_of(rows: ReadonlyArray<ChildTiming>): EpicTrend {
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

// A count of nothing is not a note. Written once so the three things worth saying about a batch's
// children read alike rather than being spelled out three times.
function count_note(count: number, tail: string): Array<string> {
	if (count === NONE) return []

	return [`${String(count)} child(ren) ${tail}`]
}

function notes_of(rows: ReadonlyArray<ChildTiming>, external_count: number): Array<string> {
	return [
		...count_note(external_count, 'live in another repository and are not measured here'),
		// "nothing was measured", not "nothing happened": `not run` covers a child the batch never
		// reached *and* one whose pull request could not be read at all, and each row carries its own
		// note saying which. A count asserting the first would report a rate-limited `gh` as an idle
		// batch.
		...count_note(
			count_status(rows, NOT_RUN),
			'have nothing measured and are reported as "not run" — each row says why',
		),
		...count_note(
			count_status(rows, NO_TRANSCRIPT),
			'merged with no session transcript attributed, so only their CI wait is known',
		),
		...count_note(
			count_status(rows, NOT_MERGED),
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

// A few children at a time rather than all of them at once, and **both shared sources read once for
// the whole batch before the fan-out starts** — the transcripts by joshuafolkken/kit#1284, the
// pull-request listing by joshuafolkken/kit#1292.
//
// Each of the two used to be read inside each child's report. The transcript walk read the same 669
// files eleven times for an eleven-child epic; the listing was paged thirteen times for the thirteen
// children of epic #1272, and the two children with no pull request read all five pages each to
// establish it — 21 requests where 5 answer every child. Neither second read could differ from the
// first: the files do not change while the command runs, and the 500 rows are the same rows.
//
// What is left per child is the check-run read, which really is per child: it is keyed on that
// child's own head sha, so there is no shared listing to lift it out of. It used to be waited on one
// child at a time, which made the command's wall clock proportional to how many children the epic
// happens to track — measured at 0.84 seconds a child, nearly half of a nine-child epic's 16.6
// seconds (joshuafolkken/kit#1300). The children do not depend on one another, so nothing was being
// ordered by that wait.
//
// The same 8 the two `epic-bundle` readers use for their own `gh` reads, and bounded for the same
// reason: an unbounded fan-out is what turns a rate limit into a wrong answer, because
// `list_check_runs` reports a refused read as an empty check list rather than as an error.
//
// **What it bounds is the whole child report, not only the check-run read**, and the difference
// matters on the fallback path: handed a `sources` half that is missing, `build_run_report` reads
// that half itself — a transcript walk, or a five-page pull listing. That is the case the width is
// smallest for, since eight of those at once is the burst this bound exists to keep off GitHub. The
// maps below hold an entry for every number asked about, so the fallback is a broken invariant
// rather than a normal case; the width is chosen for it anyway.
const CHECK_RUN_CONCURRENCY = 8

// A child whose report could not be built at all. `build_run_report` reports a *missing half* rather
// than throwing, so reaching here means the read itself broke — and one broken child must not
// discard the siblings that were measured. `bounded_map` raises the first failure and returns
// nothing, which for a nine-child epic would be eight measurements thrown away for the ninth, so the
// catch belongs in the worker rather than around the pool. The row lands as `not run` carrying the
// reason, which is the `not run` this module already documents: "a child the batch never reached
// *and* one whose pull request could not be read at all, and each row carries its own note saying
// which".
function failed_report(issue_number: number, error: unknown): TimeReport {
	const reason = error instanceof Error ? error.message : String(error)

	return time_report.build_from_spans({
		scope: `issue #${String(issue_number)}`,
		spans: [],
		started_ms: 0,
		ended_ms: 0,
		ci_ms: 0,
		has_ci_data: false,
		notes: [`issue #${String(issue_number)} could not be measured: ${reason}`],
		by_check: [],
	})
}

async function build_child(
	issue_number: number,
	cwd: string,
	read: GhReader,
	sources: RunSources,
): Promise<ChildTiming> {
	try {
		return to_timing(
			issue_number,
			await time_run.build_run_report(issue_number, cwd, read, sources),
		)
	} catch (error) {
		return to_timing(issue_number, failed_report(issue_number, error))
	}
}

async function build_children(
	numbers: ReadonlyArray<number>,
	cwd: string,
	read: GhReader,
): Promise<Array<ChildTiming>> {
	const found = time_corpus.collect_for_issues(cwd, numbers)
	const searches = await time_pull_index.pulls_for_issues(numbers, read)

	// Both maps hold an entry for every number asked about — an issue no transcript mentions and one
	// with no pull request are present with their own empty answer rather than absent, which
	// `time-corpus.test.ts` and `time-pull-index.test.ts` pin. A miss would therefore be a broken
	// invariant rather than a normal case, and `build_run_report` answers one by reading that half
	// itself: slower than this is meant to be, never wrong.
	//
	// **`bounded_map` returns in input order however the children finished**, which is what keeps the
	// rows the epic body's rather than the network's: `in_execution_order` sorts by measured start and
	// is stable, so completion order would otherwise decide where every child with no measured start
	// ends up.
	return await bounded_pool.bounded_map(
		numbers,
		CHECK_RUN_CONCURRENCY,
		async (issue_number) =>
			await build_child(issue_number, cwd, read, {
				found: found.get(issue_number),
				search: searches.get(issue_number),
			}),
	)
}

function to_epic_report(
	epic_number: number,
	rows: ReadonlyArray<ChildTiming>,
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
		timed_count: ordered.length - count_status(ordered, NOT_RUN),
		measured_count: count_status(ordered, MEASURED),
		unmeasured_count: count_status(ordered, NOT_RUN),
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
	MEASURED,
	NO_TRANSCRIPT,
	NOT_MERGED,
	NOT_RUN,
	MIN_TREND_CHILDREN,
	status_of,
	ms_per_turn_of,
	in_execution_order,
	total_categories,
	trend_of,
	read_children,
	build_epic_report,
}

export type { ChildStatus, ChildTiming, EpicChildren, EpicTimeReport, EpicTrend }
export { time_epic }
