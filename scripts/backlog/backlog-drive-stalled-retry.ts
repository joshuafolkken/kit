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
import { run_stalled, type ParkStop } from '#scripts/run/park/run-stalled'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_retry } from './backlog-drive-retry'

// joshuafolkken/kit#6865: on every offer the drive re-offers a `run:stalled` park whose recorded ship
// stop has a cheap check and that check shows the cause gone — through `run:add --retry`, at most
// `RETRY_CAP` times per issue. A park with no recorded stop, a stage with no check, or a protected
// label stays for a person; one at the cap is restated once with `CAP_NOTE`, which its board row shows.

const RETRY_CAP = 2
const CAP_NOTE = `auto-retry cap ${String(RETRY_CAP)} reached`
const { PARK } = run_event_stream.EVENT_KIND
const last_sweep = { at: -Infinity }

type CauseCheck = (issue: number) => Promise<boolean>

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

const CAUSE_CHECKS: ReadonlyMap<string, CauseCheck> = new Map([
	[run_ship_stage.STAGE.FOLLOWUP, is_followup_clear],
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

// The cause check a park's recorded stop has; none for a park with no stop, a stage with no check,
// or one already restated at the cap.
function check_of(park: RunEvent): CauseCheck | undefined {
	if (park.stop === undefined || park.text.includes(CAP_NOTE)) return undefined

	return CAUSE_CHECKS.get(park.stop.stage)
}

// The park restated with the cap note, its stop kept, so the board row hands it to a person.
async function note_cap(issue: number, stop: ParkStop | undefined): Promise<void> {
	const text = run_stalled.park_event(issue, CAP_NOTE)

	await run_event_stream_emit.emit(PARK, text, new Date(), { ...(stop && { stop }) })
}

// A refused `run:add` (a settled or withdrawn issue, an unreadable lane, a failed label write) leaves the
// park for a person instead of ending the drive.
async function retry_cleared(issue: number): Promise<void> {
	try {
		await backlog_drive_retry.add_retry(
			issue,
			`${issue_cite.plain_for('program', issue)} once its stop cleared`,
		)
	} catch (error) {
		console.error(`${String(error)} Left for a person.`)
	}
}

// The pull request is read before the issue, so a park whose cause remains costs one read.
async function is_due(issue: number, is_clear: CauseCheck, is_capped: boolean): Promise<boolean> {
	if (!is_capped && !(await is_clear(issue))) return false

	return await is_still_stalled(issue)
}

async function retry_park(
	issue: number,
	park: RunEvent,
	history: ReadonlyArray<RunEvent>,
): Promise<void> {
	const check = check_of(park)

	if (check === undefined) return
	const is_capped = run_event_retry.count_of(history, issue) >= RETRY_CAP

	if (!(await is_due(issue, check, is_capped))) return
	await (is_capped ? note_cap(issue, park.stop) : retry_cleared(issue))
}

async function retry_all(
	parks: ReadonlyArray<[number, RunEvent]>,
	history: ReadonlyArray<RunEvent>,
): Promise<void> {
	const [first, ...rest] = parks

	if (first === undefined) return
	await retry_park(first[0], first[1], history)
	await retry_all(rest, history)
}

// At most one sweep per running offer interval, so an idle watch's faster asks add no reads.
async function sweep(now = Date.now()): Promise<void> {
	if (now - last_sweep.at < backlog_budget.OFFER_INTERVAL_MS) return
	last_sweep.at = now
	const parks = latest_parks(await run_event_stream_emit.current_events())

	if (parks.size === 0) return
	await retry_all([...parks], await run_event_stream_emit.all_events())
}

export const backlog_drive_stalled_retry = { CAP_NOTE, RETRY_CAP, sweep }
