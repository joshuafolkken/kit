import { bounded_pool } from '#scripts/bounded-pool'
import { time_corpus } from './time-corpus'
import type { GhReader, PullSearch } from './time-github'
import { time_pull_index } from './time-pull-index'
import { time_report, type TimeReport } from './time-report'
import { time_run, type RunSources } from './time-run'
import { time_spans } from './time-spans'

// Measuring several runs at once — the fan-out `--epic` and `--last` both go through
// (joshuafolkken/kit#1312).
//
// It was `time-epic.ts`'s until a second scope needed it. **A batch of runs and a batch's way of
// choosing them are two different things**, and only the second differs between the two scopes: an
// epic reads its children off a task list, `--last` takes the most recently merged pull requests, and
// from there both walk the transcripts once, page the pull listing once, and build one report per run
// a few at a time. Writing the second scope's own copy of that would be the clone `CLAUDE.md`
// prohibits, in the one place where a drift would make `--epic` and `--last` disagree about what a
// run took.
//
// **What is not here is the aggregation.** How a batch is summarized — an epic's per-turn trend, a
// distribution's min/median/max — is each scope's own question, and this file answers none of it.

const NO_TURNS = 0
const NONE = 0

// What was known about one run, in five states rather than two.
//
// **None of the three that are not `measured` is a duration of zero.** A run the batch never reached,
// one whose pull request never merged, and one that merged with no session transcript attributed to
// it are three different answers, and every one of them prints as `0.0 min` if the status does not
// keep them apart. The third is the one measured on epic #1272: four children merged, each with a
// real CI wait, and not one line of transcript attributed to any of them — a row reading
// `model 0.0 min` would have asserted a measurement nobody made.
//
// **The fifth is not about the run at all** (joshuafolkken/kit#1352). `failed` says the measurement
// itself broke, where the four above say what there was to measure. It is kept apart from `not run`
// because `build_run_report` reports a *missing half* in words rather than throwing — so reaching the
// catch below means the code did, and folding that into `not run` made a regression indistinguishable
// from a batch that had simply not been started: every row plausible, the note reading "N child(ren)
// have nothing measured", and the exit code 0.
type RunStatus = 'measured' | 'no transcript' | 'not merged' | 'not run' | 'failed'

const MEASURED: RunStatus = 'measured'
const NO_TRANSCRIPT: RunStatus = 'no transcript'
const NOT_MERGED: RunStatus = 'not merged'
const NOT_RUN: RunStatus = 'not run'
const FAILED: RunStatus = 'failed'

interface RunTiming {
	issue_number: number
	status: RunStatus
	// Model wait divided by the turns it was spread over, or `undefined` where the run recorded no
	// turn at all — never `0`, which reads as an instant answer rather than as nothing measured.
	ms_per_turn: number | undefined
	// The run's whole report, breakdown included, so `--json` carries per run exactly what `--issue`
	// carries for one.
	report: TimeReport
}

// `has_ci_data` is whether a merge was actually read and `span_count` whether any transcript was
// attributed. The two are independent, so both are asked: a merge with no transcript knows only the
// CI wait, a transcript with no merge is a run that did not finish, and neither is a run that was
// never started here.
function status_of(report: TimeReport): RunStatus {
	const has_spans = time_spans.has_transcript_data(report.span_count)

	if (report.has_ci_data) return has_spans ? MEASURED : NO_TRANSCRIPT

	return has_spans ? NOT_MERGED : NOT_RUN
}

function ms_per_turn_of(report: TimeReport): number | undefined {
	if (report.turn_count === NO_TURNS) return undefined

	return report.categories.model_ms / report.turn_count
}

function to_timing(issue_number: number, report: TimeReport): RunTiming {
	return {
		issue_number,
		status: status_of(report),
		ms_per_turn: ms_per_turn_of(report),
		report,
	}
}

// A few runs at a time rather than all of them at once, and **both shared sources read once for the
// whole batch before the fan-out starts** — the transcripts by joshuafolkken/kit#1284, the
// pull-request listing by joshuafolkken/kit#1292.
//
// Each of the two used to be read inside each run's report. The transcript walk read the same 669
// files eleven times for an eleven-child epic; the listing was paged thirteen times for the thirteen
// children of epic #1272, and the two with no pull request read all five pages each to establish it —
// 21 requests where 5 answer every one. Neither second read could differ from the first: the files do
// not change while the command runs, and the 500 rows are the same rows.
//
// What is left per run is the check-run read, which really is per run: it is keyed on that run's own
// head sha, so there is no shared listing to lift it out of. It used to be waited on one run at a
// time, which made the command's wall clock proportional to how many runs the batch happens to hold —
// measured at 0.84 seconds each, nearly half of a nine-child epic's 16.6 seconds
// (joshuafolkken/kit#1300). The runs do not depend on one another, so nothing was being ordered by
// that wait.
//
// The same 8 the two `epic-bundle` readers use for their own `gh` reads, and bounded for the same
// reason: an unbounded fan-out is what turns a rate limit into a wrong answer. Since
// joshuafolkken/kit#1352 a refused check read at least *says* so rather than answering with an empty
// check list, which makes the wrong answer visible — it does not make the burst any less likely.
//
// **What it bounds is the whole run report, not only the check-run read**, and the difference matters
// on the fallback path: handed a `sources` half that is missing, `build_run_report` reads that half
// itself — a transcript walk, or a five-page pull listing. That is the case the width is smallest
// for, since eight of those at once is the burst this bound exists to keep off GitHub.
const CHECK_RUN_CONCURRENCY = 8

// A run whose report could not be built at all. `build_run_report` reports a *missing half* rather
// than throwing, so reaching here means the read itself broke — and one broken run must not discard
// the siblings that were measured. `bounded_map` raises the first failure and returns nothing, which
// for a nine-run batch would be eight measurements thrown away for the ninth, so the catch belongs in
// the worker rather than around the pool. The row lands as `failed` carrying the reason —
// deliberately not `not run`, which is the ordinary answer for a run the batch never reached
// (joshuafolkken/kit#1352).
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

// **The status is set rather than derived, because nothing in the report can carry it.** A report
// built from no spans and no merge is indistinguishable from a child the batch never reached, so
// `status_of` would answer `not run` — the very conflation joshuafolkken/kit#1352 was filed for. The
// catch above stays unconditional either way: narrowing it and re-throwing would hand the failure to
// `bounded_map`, which raises the first one and returns nothing, and eight measured siblings would go
// with it.
function failed_timing(issue_number: number, error: unknown): RunTiming {
	const report = failed_report(issue_number, error)

	return { issue_number, status: FAILED, ms_per_turn: ms_per_turn_of(report), report }
}

async function build_one(
	issue_number: number,
	cwd: string,
	read: GhReader,
	sources: RunSources,
): Promise<RunTiming> {
	try {
		return to_timing(
			issue_number,
			await time_run.build_run_report(issue_number, cwd, read, sources),
		)
	} catch (error) {
		return failed_timing(issue_number, error)
	}
}

// What a batch hands over. **`searches` is the one thing the two scopes do not share**: `--last`
// selected its runs *from* the pull-request listing and already holds each row, so paging that same
// listing a second time to look them up would spend up to five requests to learn what it just read.
// An epic starts from issue numbers alone and passes `undefined`, which reads the listing here.
//
// A record rather than four positional parameters, so a third scope adds a field instead of pushing
// past the parameter limit.
interface BatchInput {
	numbers: ReadonlyArray<number>
	cwd: string
	read: GhReader
	searches: ReadonlyMap<number, PullSearch> | undefined
}

async function searches_of(input: BatchInput): Promise<ReadonlyMap<number, PullSearch>> {
	return input.searches ?? (await time_pull_index.pulls_for_issues(input.numbers, input.read))
}

// One `RunTiming` per number asked about, in the order they were asked about.
//
// Both maps hold an entry for every number — an issue no transcript mentions and one with no pull
// request are present with their own empty answer rather than absent, which `time-corpus.test.ts` and
// `time-pull-index.test.ts` pin. A miss would therefore be a broken invariant rather than a normal
// case, and `build_run_report` answers one by reading that half itself: slower than this is meant to
// be, never wrong.
//
// **`bounded_map` returns in input order however the runs finished**, which is what keeps the rows
// the caller's rather than the network's: both scopes sort the rows afterwards with a stable sort, so
// completion order would otherwise decide where every run with no measured start ends up.
async function build_timings(input: BatchInput): Promise<Array<RunTiming>> {
	const { numbers, cwd, read } = input
	const found = time_corpus.collect_for_issues(cwd, numbers)
	const searches = await searches_of(input)

	return await bounded_pool.bounded_map(
		numbers,
		CHECK_RUN_CONCURRENCY,
		async (issue_number) =>
			await build_one(issue_number, cwd, read, {
				found: found.get(issue_number),
				search: searches.get(issue_number),
			}),
	)
}

function count_status(rows: ReadonlyArray<RunTiming>, status: RunStatus): number {
	return rows.filter((row) => row.status === status).length
}

// The two statuses with no duration to print. Asked rather than compared against each one at the call
// site, so both batch renderers — and both scopes' counts — pick up a sixth status by it being named
// here rather than by each of them remembering to.
function has_duration(timing: RunTiming): boolean {
	return timing.status !== NOT_RUN && timing.status !== FAILED
}

function count_untimed(rows: ReadonlyArray<RunTiming>): number {
	return rows.filter((row) => !has_duration(row)).length
}

// The sentence both scopes say about a `failed` row, written once for the same reason `count_note`'s
// guard is shared: an epic and a set of runs are counting different things, but this exclusion is the
// same fact about both, and a drift would leave the two scopes describing one status differently.
const FAILED_NOTE_TAIL =
	'could not be measured because the report itself failed to build — each row says why, and the command exits non-zero'

// A count of nothing is not a note. **The unit is a parameter because the two scopes count different
// things** — an epic counts children, a set of runs counts runs and the merged pull requests it left
// out — and writing the guard twice for that one word is the duplication `CLAUDE.md` prohibits, in
// the one place where a drift would make the two scopes phrase the same exclusion differently.
function count_note(count: number, unit: string, tail: string): Array<string> {
	if (count === NONE) return []

	return [`${String(count)} ${unit} ${tail}`]
}

const time_batch = {
	MEASURED,
	NO_TRANSCRIPT,
	NOT_MERGED,
	NOT_RUN,
	FAILED,
	FAILED_NOTE_TAIL,
	status_of,
	ms_per_turn_of,
	to_timing,
	count_status,
	has_duration,
	count_untimed,
	count_note,
	build_timings,
}

export type { BatchInput, RunStatus, RunTiming }
export { time_batch }
