import { time_batch, type RunTiming } from './time-batch'
import { time_distribution, type Distribution, type LabeledDistribution } from './time-distribution'
import { time_github, type GhReader, type PullSearch } from './time-github'
import { time_last_select, type RunSelection } from './time-last-select'
import { PHASE_ORDER, type PhaseName } from './time-phase-names'
import { time_report, type TimeReport } from './time-report'
import { time_spans } from './time-spans'

// The last N merged runs, read as a distribution rather than one run at a time
// (joshuafolkken/kit#1312).
//
// `.claude/skills/diag/SKILL.md` requires that a verdict rest on more than one reading, and until now
// producing that meant calling `--issue` once per run and lining the results up by hand: the
// 2026-09-04 `diag` did exactly that five times and still left two verdicts as "cannot tell", with
// nothing to say whether the cause was variance or too few readings.
//
// **Nothing here measures a run.** The runs are chosen by `time-last-select.ts` and measured by
// `time-batch.ts` — the same fan-out `--epic` goes through, so `--last` cannot report a different
// figure for a run than `--issue` does. What this file adds is the aggregation: which runs a given
// figure was actually read from, and its min, median and max across them.
//
// **A figure nobody could read is excluded, not zeroed.** Every distribution carries the number of
// runs behind it, so a phase absent from two of five runs is three samples and says so — and a run
// that merged with no transcript attributed contributes nothing to the transcript-side rows rather
// than pulling every one of them toward zero.

const NONE = 0

interface LastTimeReport {
	scope: string
	// How many were asked for, beside how many `runs` holds. A repository with three merged runs
	// answers a request for five, and the difference is a fact about the repository rather than a
	// failure — but it is only visible if both numbers are carried.
	requested_count: number
	// Newest merge first, each carrying its whole report exactly as `--epic` carries a child's.
	runs: Array<RunTiming>
	measured_count: number
	// Runs left out of the transcript-side figures because nothing was read for them. Never a count of
	// runs that took no time.
	unmeasured_count: number
	elapsed: Distribution
	categories: Array<LabeledDistribution>
	phases: Array<LabeledDistribution>
	checks: Array<LabeledDistribution>
	notes: Array<string>
}

// **The two halves are gated separately, on exactly the criteria one run's report withholds its own
// rows on.** `has_transcript_data` is whether any span was read; `has_ci_data` is whether a merge
// was. A run can have the second without the first — the case measured on epic #1272 — and folding
// them into one test would either drop its real CI wait or invent three transcript shares for it.
function transcript_reports(runs: ReadonlyArray<RunTiming>): Array<TimeReport> {
	return runs
		.map((run) => run.report)
		.filter((report) => time_spans.has_transcript_data(report.span_count))
}

function merged_reports(runs: ReadonlyArray<RunTiming>): Array<TimeReport> {
	return runs.map((run) => run.report).filter((report) => report.has_ci_data)
}

// The four shares, each over the runs that measured it. The labels are `time-report.ts`'s own, so a
// row renamed there is renamed here — the same reason the epic scope shares them.
function category_rows(runs: ReadonlyArray<RunTiming>): Array<LabeledDistribution> {
	const measured = transcript_reports(runs)
	const merged = merged_reports(runs)
	const { labeled } = time_distribution

	return [
		labeled(
			time_report.MODEL_LABEL,
			measured.map((report) => report.categories.model_ms),
		),
		labeled(
			time_report.TOOL_LABEL,
			measured.map((report) => report.categories.tool_ms),
		),
		labeled(
			time_report.HUMAN_LABEL,
			measured.map((report) => report.categories.human_ms),
		),
		labeled(
			time_report.CI_LABEL,
			merged.map((report) => report.categories.ci_ms),
		),
	]
}

// **A phase is sampled from the runs that detected it, and from no others.** `is_detected` is already
// the flag one run's report withholds a phase on, so reading it here is what keeps "this stage did
// not run in two of the five" from arriving as two zeroes that drag the median down.
function phase_samples(runs: ReadonlyArray<RunTiming>, phase: PhaseName): Array<number> {
	return runs
		.flatMap((run) => run.report.phases)
		.filter((total) => total.phase === phase && total.is_detected)
		.map((total) => total.duration_ms)
}

// In run order rather than by size, exactly as one run's phase table is: the point of the table is the
// shape of a run, and a reader comparing it against `--issue` should find the same rows in the same
// places.
function phase_rows(runs: ReadonlyArray<RunTiming>): Array<LabeledDistribution> {
	return PHASE_ORDER.map((phase) => time_distribution.labeled(phase, phase_samples(runs, phase)))
}

// Every check name any of the runs ran. A `Set` rather than a sort-and-dedupe because the order is
// decided below by the median, and a check present in one run of five still needs a row — it is
// exactly the check whose sample count a reader has to see.
function check_labels(runs: ReadonlyArray<RunTiming>): Array<string> {
	const labels = new Set<string>()

	for (const run of runs) {
		for (const check of run.report.by_check) labels.add(check.label)
	}

	return [...labels]
}

// **One sample per run, not one per check-run.** GitHub returns a retried job as an additional
// check-run carrying the same name on the same head sha, so flat-mapping the rows would give a
// three-run set four readings of `E2E` — and the sample count is the one thing on the row a reader
// leans on. The longest attempt is the run's reading, because that is what the merge waited through.
function check_of(run: RunTiming, label: string): number | undefined {
	const durations = run.report.by_check
		.filter((check) => check.label === label)
		.map((check) => check.duration_ms)

	return durations.length === NONE ? undefined : Math.max(...durations)
}

function check_samples(runs: ReadonlyArray<RunTiming>, label: string): Array<number> {
	return runs
		.map((run) => check_of(run, label))
		.filter((duration_ms): duration_ms is number => duration_ms !== undefined)
}

function check_rows(runs: ReadonlyArray<RunTiming>): Array<LabeledDistribution> {
	const rows = check_labels(runs).map((label) =>
		time_distribution.labeled(label, check_samples(runs, label)),
	)

	return time_distribution.by_median_desc(rows)
}

// The guard is `time-batch.ts`'s, shared with the epic scope; the unit is this scope's own word.
function count_note(count: number, tail: string): Array<string> {
	return time_batch.count_note(count, 'run(s)', tail)
}

// **A failed read is reported even when the full count came back**, because what it costs is not the
// count but the claim: some of the listing went unread, so these may not be the *last* N. The two
// sentences are separate for that reason — "5 of the 5 asked for were resolved" reads as a no-op
// beside a warning, and the warning is the whole content of this note.
function failed_note(requested: number, found: number): Array<string> {
	const tail = 'so these may not be the most recent merges'

	if (found >= requested) {
		return [`the pull-request listing could not be read to the end — ${tail}`]
	}

	return [
		`the pull-request listing could not be read to the end — ${String(found)} of the ${String(requested)} asked for were resolved, ${tail}`,
	]
}

// Why there are fewer runs than were asked for. **Three different sentences, because the three are
// three different facts**: the listing could not be read, it was read to its cap without finding
// enough, or the repository genuinely holds no more.
function shortfall_note(requested: number, selection: RunSelection): Array<string> {
	const found = selection.runs.length
	const asked = `${String(found)} of the ${String(requested)} asked for`

	if (selection.end === 'failed') return failed_note(requested, found)

	if (selection.end === 'capped') {
		const budget = String(time_github.MAX_PAGES * time_github.PAGE_SIZE)

		return [`${asked} were found among the ${budget} most recently updated pull requests`]
	}

	return [`the repository holds only ${asked}`]
}

function shortfall_notes(requested: number, selection: RunSelection): Array<string> {
	if (selection.runs.length >= requested && selection.end !== 'failed') return []

	return shortfall_note(requested, selection)
}

function skipped_note(count: number): Array<string> {
	const tail = 'name no issue in their head branch, so they are not runs and are left out'

	return time_batch.count_note(count, 'merged pull request(s)', tail)
}

// **The two exclusions are named separately, and neither reads as a zero.** A run that merged with no
// transcript still contributed its CI wait, so it is in the check rows and out of the transcript ones;
// a run whose report could not be built at all is out of every one of them and carries its own reason.
function notes_of(
	requested: number,
	runs: ReadonlyArray<RunTiming>,
	selection: RunSelection,
): Array<string> {
	return [
		...shortfall_notes(requested, selection),
		...skipped_note(selection.skipped_count),
		...count_note(
			time_batch.count_status(runs, time_batch.NO_TRANSCRIPT),
			'merged with no session transcript attributed, so only their CI wait is known — they are excluded from the elapsed and transcript-side rows as unmeasured rather than counted as zero',
		),
		...count_note(
			time_batch.count_status(runs, time_batch.NOT_RUN),
			'could not be measured at all and are excluded — each row carries its own reason',
		),
	]
}

function scope_of(count: number): string {
	return `the last ${String(count)} merged run(s)`
}

function to_report(
	requested_count: number,
	runs: ReadonlyArray<RunTiming>,
	selection: RunSelection,
): LastTimeReport {
	const measured_count = time_batch.count_status(runs, time_batch.MEASURED)

	return {
		scope: scope_of(runs.length),
		requested_count,
		runs: [...runs],
		measured_count,
		unmeasured_count: runs.length - measured_count,
		elapsed: time_distribution.build(transcript_reports(runs).map((report) => report.elapsed_ms)),
		categories: category_rows(runs),
		phases: phase_rows(runs),
		checks: check_rows(runs),
		notes: notes_of(requested_count, runs, selection),
	}
}

// **The pull requests are handed to the fan-out rather than looked up again.** The selection walked
// the listing to find them, so paging it a second time would spend up to five more requests to learn
// what it just read — and let the two reads disagree if something merged in between.
function searches_of(selection: RunSelection): Map<number, PullSearch> {
	return new Map(
		selection.runs.map((run) => [run.issue_number, time_github.to_found(run.pull)] as const),
	)
}

// The last `count` merged runs, measured. `undefined` means no merged run could be resolved at all —
// reported in words by the caller, never as an empty distribution, which would read as a repository
// whose runs all took no time.
async function build_last_report(
	count: number,
	cwd: string,
	read: GhReader = time_github.read_gh,
): Promise<LastTimeReport | undefined> {
	const selection = await time_last_select.select_last_runs(count, read)

	if (selection.runs.length === NONE) return undefined

	const runs = await time_batch.build_timings({
		numbers: selection.runs.map((run) => run.issue_number),
		cwd,
		read,
		searches: searches_of(selection),
	})

	return to_report(count, runs, selection)
}

const time_last = {
	transcript_reports,
	category_rows,
	phase_rows,
	check_rows,
	build_last_report,
}

export type { LastTimeReport }
export { time_last }
