import { time_format } from './time-format'
import type { CheckRun } from './time-github'

// What each CI check concluded, and whether it finished in time to have held the merge up
// (joshuafolkken/kit#1310).
//
// The check table used to carry a name and a duration and nothing else, so two rows a reader has to
// tell apart printed identically. On the run this was filed from, `E2E`, `auto-merge` and
// `Notify Auto Tag` all printed `0.0 min` — one of them skipped, the others completed in under a
// second — and `CodeRabbit` printed a six-minute duration it spent *after* the merge, where it could
// not have delayed anything. Ranking the wait off that table therefore put the run's slowest row at
// the top of a list of things to cut, when the thing to cut was not on it.
//
// **The merge instant is what makes both readable**, and it was already fetched: `time-run.ts` reads
// `merged_at` for the CI wait. So each row carries its distance from that instant, and the
// conclusion GitHub already sends beside it.
//
// **It renders the third column rather than the whole table.** The 15-row display cap and the
// overflow note belong to `time-report.ts`'s one table renderer, which every table in the report goes
// through; a second renderer here would be the clone `CLAUDE.md` prohibits, in the one place where a
// drift makes two tables of the same report disagree about where a column starts.

// GitHub's own spelling of the conclusion that means the job never ran. Compared against rather than
// interpreted: every other conclusion — `success`, `failure`, `cancelled`, `timed_out`, `neutral` —
// is printed as it came, so a value this file has never heard of still reaches the reader.
const SKIPPED_CONCLUSION = 'skipped'

const CHECK_HEADING = 'By CI check (descending, jobs overlap):'
// What a row says where GitHub sent no conclusion at all. **Not an empty column**: a blank there
// reads as a check with nothing to report, which is the silent unknown this command exists to remove.
const NO_CONCLUSION = 'no conclusion recorded'
// The two readings of a zero-length row, which the duration alone cannot tell apart.
const SKIPPED_NOTE = 'did not run'
const INSTANT_NOTE = 'completed instantly'
const AFTER_MERGE_NOTE = 'after the merge'
const MERGE_WAIT_PREFIX = 'the merge waited on'
const MERGE_WAIT_SUFFIX = 'the last check to finish before it'
// What is said instead where the merge came long after the last check: the finish is still a fact,
// the waiting is not.
const LAST_TO_FINISH_NOTE = 'was the last check to finish,'
const BEFORE_MERGE_SUFFIX = 'before the merge — the merge itself waited on something else'
const NO_BLOCKING_CHECK = 'no check finished before the merge — none of these is what it waited on'
const SEPARATOR = ' · '
const NO_DURATION = 0
const AT_THE_MERGE = 0
// How close the merge has to follow the last check for the merge to be said to have waited on it.
const MS_PER_MINUTE = 60_000

// One CI job as the report prints it.
//
// **`merge_gap_ms` is signed on purpose, and both signs are read.** Positive means the job finished
// after the merge, so it cannot have held the merge up whatever its duration says; zero or negative
// means it finished before, and the greatest of those — the latest finisher — is the one the merge
// actually waited on. Two booleans would carry the first half and lose the second.
//
// `conclusion` is the string GitHub sent, empty where it sent none.
interface CheckTotal {
	label: string
	duration_ms: number
	conclusion: string
	merge_gap_ms: number
}

function is_skipped(check: CheckTotal): boolean {
	return check.conclusion === SKIPPED_CONCLUSION
}

function is_after_merge(check: CheckTotal): boolean {
	return check.merge_gap_ms > AT_THE_MERGE
}

// Clamped at zero, because GitHub really does stamp a check as completed a fraction of a second
// before it started — measured on PR #1277, whose `Notify Auto Tag` printed as `-0.0 min`. A
// negative duration is a clock artefact, not a measurement, and it sorts to the bottom of a table
// where a reader reads it as a real figure.
function to_total(run: CheckRun, merged_ms: number): CheckTotal {
	return {
		label: run.name,
		duration_ms: Math.max(NO_DURATION, run.completed_ms - run.started_ms),
		conclusion: run.conclusion,
		merge_gap_ms: run.completed_ms - merged_ms,
	}
}

// **The merge instant is required rather than optional.** Checks are only ever read for a pull
// request that merged, so a caller with no merge time has no check set either — and accepting one
// would mean inventing a gap, which is exactly the measured zero standing in for an unknown that the
// rest of this command withholds.
function build_check_totals(runs: ReadonlyArray<CheckRun>, merged_ms: number): Array<CheckTotal> {
	return runs
		.map((run) => to_total(run, merged_ms))
		.toSorted((left, right) => right.duration_ms - left.duration_ms)
}

function conclusion_text(check: CheckTotal): string {
	return check.conclusion === '' ? NO_CONCLUSION : check.conclusion
}

// **Why a zero-length row is zero, which is the whole of acceptance criterion three.** A skipped job
// says so from its conclusion whatever its stamps; anything else that took no measurable time really
// did run and really did finish at once, and saying nothing there leaves the two indistinguishable.
function outcome_note(check: CheckTotal): Array<string> {
	if (is_skipped(check)) return [SKIPPED_NOTE]
	if (check.duration_ms === NO_DURATION) return [INSTANT_NOTE]

	return []
}

// A job that finished after the merge is reported with how much later, because that figure is the
// argument: `CodeRabbit` four minutes past the merge is not a slow required check, it is a check the
// merge never waited for.
//
// **A skipped job is exempt, and that is not cosmetic.** Its two stamps are the moment the workflow
// evaluated the `if:` that turned it off, not work — so a post-merge job that was skipped would print
// `skipped · did not run · finished 2.0 min after the merge`, which reads as a claim about when it
// ran. There is nothing there to place either side of the merge.
function merge_note(check: CheckTotal): Array<string> {
	if (is_skipped(check) || !is_after_merge(check)) return []

	return [`finished ${time_format.format_minutes(check.merge_gap_ms)} ${AFTER_MERGE_NOTE}`]
}

function check_suffix(check: CheckTotal): string {
	return [conclusion_text(check), ...outcome_note(check), ...merge_note(check)].join(SEPARATOR)
}

// The jobs that ran and finished before the merge.
//
// **Only `skipped` is excluded, and no other conclusion is.** The claim below is about *finishing*,
// not about passing, so a job that failed or was cancelled still finished and the merge still sat
// behind it until it did. A skipped one never ran at all, so its stamps are not a finish.
function blocking_checks(checks: ReadonlyArray<CheckTotal>): Array<CheckTotal> {
	return checks.filter((check) => !is_after_merge(check) && !is_skipped(check))
}

// The latest of them to finish. **The greatest gap, not the longest duration**: a job that started
// early and ran for ten minutes was over long before a two-minute one that started last, and the
// merge waited for whichever finished last.
function last_blocking(checks: ReadonlyArray<CheckTotal>): CheckTotal | undefined {
	return blocking_checks(checks).toSorted(
		(left, right) => right.merge_gap_ms - left.merge_gap_ms,
	)[0]
}

// **"The last check finished" and "the merge waited on it" are two different claims, and only the
// first is always true.** CI going green three minutes in and a person merging two hours later is an
// ordinary run — a `halfrun` picked up the next morning, a pull request left for a review — and
// asserting there that the merge waited on the last check attributes a two-hour human wait to CI,
// which is the misattribution this whole change exists to remove.
//
// So the second claim is made only where the merge followed the last finish closely. The tolerance is
// a minute for the same reason `time-run.ts`'s window note uses one: below that the two instants are
// the same event to a reader, and above it there is something else in between worth not blaming CI
// for.
function merge_wait_line(check: CheckTotal): string {
	const before_ms = -check.merge_gap_ms

	if (before_ms < MS_PER_MINUTE) {
		return `  ${MERGE_WAIT_PREFIX} ${check.label} — ${MERGE_WAIT_SUFFIX}`
	}

	const gap = time_format.format_minutes(before_ms)

	return `  ${check.label} ${LAST_TO_FINISH_NOTE} ${gap} ${BEFORE_MERGE_SUFFIX}`
}

// The one sentence the table is read for. **Printed under the rows rather than in `notes`**, because
// it is about this table and a note sits above every table in the report.
//
// An empty check set prints nothing at all — there is no table for it to sit under — and a set whose
// every row was skipped or landed after the merge says so rather than naming one of them.
function merge_wait_lines(checks: ReadonlyArray<CheckTotal>): Array<string> {
	if (checks.length === 0) return []

	const blocking = last_blocking(checks)

	if (blocking === undefined) return [`  ${NO_BLOCKING_CHECK}`]

	return [merge_wait_line(blocking)]
}

const time_checks = {
	CHECK_HEADING,
	SKIPPED_CONCLUSION,
	NO_CONCLUSION,
	SKIPPED_NOTE,
	INSTANT_NOTE,
	AFTER_MERGE_NOTE,
	MERGE_WAIT_PREFIX,
	MERGE_WAIT_SUFFIX,
	LAST_TO_FINISH_NOTE,
	BEFORE_MERGE_SUFFIX,
	NO_BLOCKING_CHECK,
	is_skipped,
	is_after_merge,
	build_check_totals,
	check_suffix,
	last_blocking,
	merge_wait_lines,
}

export type { CheckTotal }
export { time_checks }
