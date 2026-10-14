import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_cite } from '#scripts/issue/issue-cite'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_dispatch, type DispatchOutcome } from './lane-dispatch'
import { lane_preserve } from './lane-preserve'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'

// `josh lane:restart <N>` — a person stops a running lane child and starts its issue over in a fresh
// session, typically after correcting the Issue's specification mid-run.
//
// **The restart is a hand-off inside the parent's re-confirm window, not a recovery.** Killing the child
// alone would let `lane:await` book it stopped and `run:merge` classify it — an `outage` resumes the old
// session with the old specification in mind, anything else is parked `needs-decision` and counted as a
// failure. `run:cut` already hands a lane to a new process inside `lane:await`'s re-confirm window, so a
// child that disappears and reappears under the same `fullrun #<N>` pattern is never collected: the
// restart stops, stashes and re-dispatches within that window, and no failure or outage is counted.
//
// **No GitHub round-trip sits between the stop and the launch**, since one slow answer would outlast the
// window. The `in-progress` marker is claimed while the old child still runs — a refused claim stops
// nothing — and the Issue comment naming the stash is posted after the fresh child is up.
//
// The fresh dispatch reads no exit record (an outage record would otherwise resume the stopped session),
// a carried cut is ended (its successor would adopt the old hand-off), and the work in the tree is
// stashed with the recovery line on the Issue. The `restart` event follows the dispatch's own
// `child-launch`, so the stream and `run:board` say a person restarted the child.

const RESTART_OCCASION = 'lane restart'
const RESTART_CAUSE = 'a person restarted its child with `lane:restart`'
const DISPATCHED_KIND = 'dispatched'
const NO_LANE_KIND = 'no-lane'
const NOT_RUNNING_KIND = 'not-running'
const UNCLAIMED_KIND = 'unclaimed'

interface Unsaved {
	kind: 'unsaved'
	directory: string
	reason: string
}

interface Restarted {
	kind: 'restarted'
	dispatch: DispatchOutcome
	stash: string | undefined
}

type Refused =
	| { kind: typeof NO_LANE_KIND }
	| { kind: typeof NOT_RUNNING_KIND }
	| { kind: typeof UNCLAIMED_KIND; reason: string }
type RestartOutcome = Restarted | Unsaved | Refused
type Saved = Unsaved | { kind: 'saved'; stash: string | undefined }

// A cut the stopped child carried would hand its successor the old session's hand-off at
// `run:cut --resume`; the fresh session has to start from the Issue instead.
function end_carried_cut(lane: LaneInfo): void {
	const carried = run_cut.lane_cut_sync(lane.directory)

	if (carried !== undefined) run_cut.end_cut(carried.target)
}

async function stash_of(lane: LaneInfo): Promise<string | undefined> {
	if (!(await git_stash.has_changes(lane.directory))) return undefined

	return await lane_preserve.push_work(lane.issue, lane.directory, RESTART_OCCASION)
}

// A tree that could not be read or pushed is left as it is: re-dispatching into it would hand the fresh
// session the stopped one's half-done work as though it were its own.
async function save_work(lane: LaneInfo): Promise<Saved> {
	try {
		return { kind: 'saved', stash: await stash_of(lane) }
	} catch (error) {
		return { kind: 'unsaved', directory: lane.directory, reason: error_text.message_of(error) }
	}
}

async function record_restart(issue: string): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.RESTART,
		`${issue_cite.plain(issue)} restarted in a fresh session by a person`,
	)
}

async function relaunch(lane: LaneInfo): Promise<RestartOutcome> {
	end_carried_cut(lane)
	const saved = await save_work(lane)

	if (saved.kind === 'unsaved') return saved
	const dispatch = await lane_dispatch.dispatch_child(lane.issue, 'restart')

	if (dispatch.kind === DISPATCHED_KIND) await record_restart(lane.issue)

	if (saved.stash !== undefined) {
		await lane_preserve.announce(lane.issue, saved.stash, RESTART_CAUSE)
	}

	return { kind: 'restarted', dispatch, stash: saved.stash }
}

/** Stop the running child of `#<N>`'s lane and re-dispatch the issue there in a fresh session. */
async function restart(issue: string): Promise<RestartOutcome> {
	issue_number_shape.require_issue_number(issue)
	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return { kind: NO_LANE_KIND }
	if (!lane_reap.is_child_running(issue)) return { kind: NOT_RUNNING_KIND }
	const claim = await lane_dispatch.claim_marker(issue)

	if (!claim.is_applied) return { kind: UNCLAIMED_KIND, reason: claim.reason }
	lane_reap.reap_child(issue)

	return await relaunch(lane)
}

function stash_sentence(stash: string | undefined): string {
	if (stash === undefined) return 'The lane held no uncommitted work.'

	return `Its uncommitted work was stashed — recover with \`pnpm josh stash:pop "${stash}"\`.`
}

// A dispatch that failed leaves the stopped child to `run:merge`: nothing re-appeared inside the
// re-confirm window, so the parent collects it as it would any stopped child.
function restarted_text(outcome: Restarted, issue: string): string {
	const head = `Stopped the child for ${session_cite.issue(issue)}. ${stash_sentence(outcome.stash)}`
	const dispatch = lane_dispatch.describe(outcome.dispatch, issue)

	if (outcome.dispatch.kind === DISPATCHED_KIND) return `${head} ${dispatch}`

	return `${head} The fresh dispatch failed, so \`run:merge\` will collect the stopped child: ${dispatch}`
}

function unsaved_text(outcome: Unsaved, issue: string): string {
	return `The child for ${session_cite.issue(issue)} was stopped, but its uncommitted work could not be stashed (${outcome.reason}), so nothing was re-dispatched and the lane is left at ${outcome.directory}; \`run:merge\` will collect the stopped child.`
}

function refused_text(outcome: Refused, issue: string): string {
	const cited = session_cite.issue(issue)

	if (outcome.kind === NO_LANE_KIND) {
		return `No lane is open for ${cited}, so there is no child to restart.`
	}

	if (outcome.kind === UNCLAIMED_KIND) {
		return `The \`${IN_PROGRESS_LABEL}\` label could not be confirmed on ${cited} (${outcome.reason}), so the running child was left as it is — nothing was stopped or re-dispatched.`
	}

	return `No child is running in the lane for ${cited}, so nothing was stopped or re-dispatched — a child that has already ended is \`run:merge\`'s to collect.`
}

function describe(outcome: RestartOutcome, issue: string): string {
	if (outcome.kind === 'unsaved') return unsaved_text(outcome, issue)

	return outcome.kind === 'restarted'
		? restarted_text(outcome, issue)
		: refused_text(outcome, issue)
}

const lane_restart = { describe, restart }

export type { RestartOutcome }
export { lane_restart }
