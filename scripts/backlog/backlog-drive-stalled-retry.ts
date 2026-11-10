import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_pr_snapshot } from '#scripts/gh/git-gh-pr-snapshot'
import {
	collect_blocking_failures,
	is_mergeable_state,
	REQUIRED_CHECKS,
} from '#scripts/gh/git-pr-checks-eval'
import { absent_required } from '#scripts/gh/git-pr-checks-missing'
import { parse_pr_state_snapshot } from '#scripts/gh/git-pr-checks-parse'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_label_name, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { lane_paths } from '#scripts/lane/lane-paths'
import { run_add } from '#scripts/run/add/run-add'
import { run_add_issue } from '#scripts/run/add/run-add-issue'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_retry } from './backlog-drive-retry'
import { backlog_yield_cap } from './backlog-yield-cap'

// joshuafolkken/kit#6865, joshuafolkken/kit#7076: on every offer the drive re-offers a `run:stalled`
// park whose check shows its cause gone — through `run:add --retry`, at most `RETRY_CAP` times per
// issue, counted off the whole stream so a restarted drive counts the retries before it. A recorded
// ship stop is checked by its stage; a park with no stop by its cause: `run:merge`'s three wait for the
// next sweep, a yield-cap park for its window. Any other park, or a protected label, stays for a person;
// one at the cap is restated once with `CAP_NOTE` and its cause, which its board row shows.

const RETRY_CAP = 2
const CAP_NOTE = `auto-retry cap ${String(RETRY_CAP)} reached`
const { PARK } = run_event_stream.EVENT_KIND
const last_sweep = { at: -Infinity }

type CauseCheck = (issue: number, park: RunEvent, now: number) => Promise<boolean>

interface SweepContext {
	history: ReadonlyArray<RunEvent>
	now: number
}

// A `followup` stop is gone once the lane's pull request has a check-run for every required check, none
// of them is red and its merge state is mergeable — a merge wait blocked by a review or a conflict
// would only time out again. No pull request, or one that cannot be read, is not shown cleared.
async function is_followup_clear(issue: number): Promise<boolean> {
	try {
		const branch = lane_paths.lane_branch(String(issue))
		const { snapshot_json } = await git_gh_pr_snapshot.pr_get_checks_snapshot(branch)
		const snapshot = parse_pr_state_snapshot(snapshot_json)

		return (
			absent_required(snapshot, REQUIRED_CHECKS).length === 0 &&
			collect_blocking_failures(snapshot).length === 0 &&
			is_mergeable_state(snapshot)
		)
	} catch {
		return false
	}
}

// A session that ended unfinished, or a cut no successor took, names nothing a read could show
// cleared: the next sweep re-offers it.
async function is_next_sweep(): Promise<boolean> {
	return true
}

// A yield-cap park waits out the window its trip counted in, so the re-offer does not trip at once.
async function is_window_passed(_issue: number, park: RunEvent, now: number): Promise<boolean> {
	return Date.parse(park.at) + backlog_yield_cap.WINDOW_MS <= now
}

const STAGE_CHECKS: ReadonlyMap<string, CauseCheck> = new Map([
	[run_ship_stage.STAGE.FOLLOWUP, is_followup_clear],
])

const CAUSE_CHECKS: ReadonlyMap<string, CauseCheck> = new Map([
	[run_stalled.SESSION_UNFINISHED.short, is_next_sweep],
	[run_stalled.CUT_NOT_RELAUNCHED.short, is_next_sweep],
	[run_stalled.STALE_HANDOFF.short, is_next_sweep],
	[backlog_yield_cap.TRIP_CAUSE, is_window_passed],
])

// Each issue's newest park within its current attempt.
function latest_parks(events: ReadonlyArray<RunEvent>): ReadonlyMap<number, RunEvent> {
	const parks = new Map<number, RunEvent>()

	for (const event of run_event_retry.current_attempts(events)) {
		const issue = run_event_scope.issue_named(event)

		if (issue !== undefined && event.kind === PARK) parks.set(Number(issue), event)
	}

	return parks
}

// Still open, still `run:stalled` and free of a protected label `run:add` would refuse. An issue that
// cannot be read is not re-offered.
async function is_still_stalled(issue: number): Promise<boolean> {
	const read = await run_add_issue.read(issue)

	if (read === undefined) return false
	const labels = epic_issue.label_names(read)

	return (
		epic_issue.is_open(read.state) &&
		has_label_name(labels, RUN_STALLED_LABEL) &&
		run_add.protected_label(labels) === undefined
	)
}

// The check a park's recorded stop has, or with no stop its cause; none for a stage or cause with no
// check, or a park already restated at the cap.
function check_of(park: RunEvent): CauseCheck | undefined {
	if (park.text.includes(CAP_NOTE)) return undefined
	if (park.stop !== undefined) return STAGE_CHECKS.get(park.stop.stage)

	return CAUSE_CHECKS.get(run_stalled.class_of(run_stalled.cause_in(park.text) ?? ''))
}

// The cap note, followed by the cause the park recorded.
function cap_cause(park: RunEvent): string {
	const cause = run_stalled.cause_in(park.text) ?? ''

	return cause === '' ? CAP_NOTE : `${CAP_NOTE} — ${cause}`
}

// The park restated with the cap note and its cause, its stop kept, so the board row hands it to a
// person.
async function note_cap(issue: number, park: RunEvent): Promise<void> {
	const text = run_stalled.park_event(issue, cap_cause(park))
	const { stop } = park

	await run_event_stream_emit.emit(PARK, text, new Date(), { ...(stop && { stop }) })
}

// A refused `run:add` (a settled or withdrawn issue, an unreadable lane, a failed label write) leaves the
// park for a person instead of ending the drive.
async function retry_cleared(issue: number): Promise<void> {
	try {
		await backlog_drive_retry.add_retry(
			issue,
			`${issue_cite.plain_for('program', issue)} automatically`,
		)
	} catch (error) {
		console.error(`${String(error)} Left for a person.`)
	}
}

// The cause is checked before the issue is read, so a park whose cause remains costs one read at most.
async function is_due(
	issue: number,
	park: RunEvent,
	is_cleared: CauseCheck,
	due: { is_capped: boolean; now: number },
): Promise<boolean> {
	if (!due.is_capped && !(await is_cleared(issue, park, due.now))) return false

	return await is_still_stalled(issue)
}

async function retry_park(issue: number, park: RunEvent, context: SweepContext): Promise<void> {
	const cause_check = check_of(park)

	if (cause_check === undefined) return
	const is_capped = run_event_retry.count_of(context.history, issue) >= RETRY_CAP

	if (!(await is_due(issue, park, cause_check, { is_capped, now: context.now }))) return
	await (is_capped ? note_cap(issue, park) : retry_cleared(issue))
}

async function retry_all(
	parks: ReadonlyArray<[number, RunEvent]>,
	context: SweepContext,
): Promise<void> {
	const [first, ...rest] = parks

	if (first === undefined) return
	await retry_park(first[0], first[1], context)
	await retry_all(rest, context)
}

// At most one sweep per running offer interval, so an idle watch's faster asks add no reads.
async function sweep(now = Date.now()): Promise<void> {
	if (now - last_sweep.at < backlog_budget.OFFER_INTERVAL_MS) return
	last_sweep.at = now
	const parks = latest_parks(await run_event_stream_emit.current_events())

	if (parks.size === 0) return
	await retry_all([...parks], { history: await run_event_stream_emit.all_events(), now })
}

export const backlog_drive_stalled_retry = { CAP_NOTE, RETRY_CAP, sweep }
