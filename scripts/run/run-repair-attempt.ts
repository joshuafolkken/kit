import { statSync } from 'node:fs'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { pr_info_schema } from '#scripts/git/git-schemas'
import { repository_lock } from '#scripts/git/repository-lock'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { json_value } from '#scripts/lib/json-value'
import { run_add } from './add/run-add'
import { run_carry } from './carry/run-carry'
import { run_cut } from './cut/run-cut'
import { run_event_retry } from './event/run-event-retry'
import { run_event_scope } from './event/run-event-scope'
import { run_event_stream, type RunEvent } from './event/run-event-stream'
import { run_event_stream_emit } from './event/run-event-stream-emit'
import { run_pr_return } from './run-pr-return'
import { run_ship_detach } from './ship/run-ship-detach'

// A reviewed PR starts a repair only after the previous worker ended. The existing retry event is
// the attempt boundary; its repair suffix makes a repeated queue request idempotent.
const REPAIR_SUFFIX = ' repair'
const LOCK_WAIT_MS = 5000
const PERMANENT_KINDS: ReadonlySet<string> = new Set(['merge', 'withdraw', 'split'])
const QUEUED_END_KINDS: ReadonlySet<string> = new Set([
	...PERMANENT_KINDS,
	run_event_stream.EVENT_KIND.HUMAN_REVIEW,
	run_event_stream.EVENT_KIND.CHILD_LAUNCH,
	run_event_stream.EVENT_KIND.PARK,
])
const WRITE_FAILED = 'Could not record the repair attempt boundary.'

function repair_text(issue: string): string {
	return `${run_event_retry.text_of(Number(issue))}${REPAIR_SUFFIX}`
}

function issue_attempt(events: ReadonlyArray<RunEvent>, issue: string): ReadonlyArray<RunEvent> {
	return run_event_retry
		.current_attempts(events)
		.filter((event) => run_event_scope.issue_named(event) === issue)
}

function is_queued(events: ReadonlyArray<RunEvent>, issue: string): boolean {
	return (
		events[0]?.text === repair_text(issue) &&
		events.every((event) => !QUEUED_END_KINDS.has(event.kind))
	)
}

function reviewed_at(events: ReadonlyArray<RunEvent>): string | undefined {
	if (events.some((event) => PERMANENT_KINDS.has(event.kind))) return undefined

	return events.findLast((event) => event.kind === run_event_stream.EVENT_KIND.HUMAN_REVIEW)?.at
}

async function is_unprotected(issue: string): Promise<boolean> {
	const read = await issue_state_cli.read_issue(issue)

	return (
		read.kind === 'state' &&
		read.state.state === 'OPEN' &&
		run_add.protected_label(read.state.labels) === undefined
	)
}

async function is_returned(lane: LaneInfo, since: string | undefined): Promise<boolean> {
	const raw = await git_gh_command.pr_view(lane.branch)

	if (json_value.parse_with(raw, pr_info_schema)?.state !== 'OPEN') return false
	if (since === undefined) return true
	const returned = await run_pr_return.read(lane.issue, lane.directory)

	return run_pr_return
		.comments_since(returned.comments, Date.parse(since))
		.some((comment) => comment.is_trusted === true)
}

function cut_target(lane: LaneInfo): string | undefined {
	const directory = git_common_directory.own(lane.directory)

	return directory === undefined ? undefined : run_cut.cut_path(directory)
}

function can_end_cut(target: string, lane: LaneInfo): boolean {
	const read = run_cut.read_cut(target)

	if (read.kind === 'none') return true
	if (read.kind === 'unreadable') return false

	return (
		read.cut.issue === lane.issue &&
		read.cut.branch === lane.branch &&
		read.cut.invocation === run_cut.invocation_for(lane.issue)
	)
}

async function append_boundary(issue: string): Promise<void> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) throw new Error(WRITE_FAILED)
	const result = await run_event_stream_emit.append_at(
		target,
		run_event_stream.EVENT_KIND.ADD,
		repair_text(issue),
		new Date(),
	)

	if (!result.appended) throw new Error(WRITE_FAILED)
}

async function has_ended_ship(issue: string): Promise<boolean> {
	const repository = await run_carry.repository_directory()

	if (repository === undefined) return false
	const info = statSync(run_ship_detach.result_path(repository, issue), { throwIfNoEntry: false })

	if (info === undefined) return true
	const result = run_ship_detach.read_result(repository, issue)

	return result !== undefined && result.result !== 'running'
}

// Uncommitted work in the lane means its `in-progress` still marks a live hand-off; a tree git
// cannot read counts as uncommitted (joshuafolkken/kit#7493).
async function is_clean(lane: LaneInfo): Promise<boolean> {
	try {
		return (await git_command.status(lane.directory)) === ''
	} catch {
		return false
	}
}

async function is_repairable(issue: string, lane: LaneInfo): Promise<boolean> {
	return (await is_unprotected(issue)) && (await is_clean(lane))
}

async function ready_lane(issue: string): Promise<LaneInfo | undefined> {
	if ((await lane_await.other_process_trace(issue)) !== 'none' || !(await has_ended_ship(issue))) {
		return undefined
	}

	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined || !(await is_repairable(issue, lane))) return undefined

	return lane
}

function eligible_cut_target(
	lane: LaneInfo,
	expected_target: string | undefined,
): string | undefined {
	const target = cut_target(lane)

	if (expected_target !== undefined && expected_target !== target) return undefined

	return target !== undefined && can_end_cut(target, lane) ? target : undefined
}

async function finish(
	lane: LaneInfo,
	events: ReadonlyArray<RunEvent>,
	since: string | undefined,
	expected_target: string | undefined,
): Promise<boolean> {
	const target = eligible_cut_target(lane, expected_target)

	if (target === undefined || !(await is_returned(lane, since))) return false
	if (!is_queued(events, lane.issue)) await append_boundary(lane.issue)
	run_cut.end_cut(target)

	return true
}

function is_candidate(events: ReadonlyArray<RunEvent>, issue: string): boolean {
	return reviewed_at(events) !== undefined || is_queued(events, issue)
}

function checked_preparation(
	is_prepared: boolean,
	events: ReadonlyArray<RunEvent>,
	issue: string,
): boolean {
	if (!is_prepared && is_queued(events, issue)) {
		throw new Error('Could not safely resume the queued repair.')
	}

	return is_prepared
}

async function prepare_held(issue: string, expected_target: string | undefined): Promise<boolean> {
	const events = issue_attempt(await run_event_stream_emit.all_events(true), issue)

	if (!is_candidate(events, issue)) return false
	const lane = await ready_lane(issue)

	const is_prepared =
		lane === undefined ? false : await finish(lane, events, reviewed_at(events), expected_target)

	return checked_preparation(is_prepared, events, issue)
}

async function prepare(issue: string, expected_target?: string): Promise<boolean> {
	const lock = repository_lock.lock_path(`josh-repair-${issue}-`)
	const is_prepared = await repository_lock.with_lock(
		async () => await prepare_held(issue, expected_target),
		lock,
		LOCK_WAIT_MS,
	)

	if (is_prepared === undefined) throw new Error('Could not lock the repair attempt.')

	return is_prepared
}

const run_repair_attempt = { issue_attempt, prepare, reviewed_at }

export { run_repair_attempt }
