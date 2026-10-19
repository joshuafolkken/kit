import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { StallCause } from '#scripts/run/park/run-stalled'
import { run_ending } from '#scripts/run/run-ending'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { run_ship_stop_text } from '#scripts/run/ship/run-ship-stop-text'

// Why `run:merge` parks a child whose detached ship has already ended (joshuafolkken/kit#3808).
//
// **A child that handed its region to `josh ship --detach` is parked for what its ship did.** A running
// ship is never parked (`merge_child` answers `shipping` first), so a park after a hand-off means the
// ship ended unmerged — and the session the ship relaunched to fix it ended too. The generic "session
// ended with its issue open" then hides the one fact a person needs: the stage the ship stopped at. The
// cause is that stage's `ship-stop` line, written by the supervisor since its own launch; a ship that
// ended without one (killed, or failed before any stage) is named by its result and its log instead.

type ShipEnding = ReturnType<typeof run_ship_detach.read_result>

const ENDED_RESULTS: ReadonlySet<string> = new Set(['failed', 'abnormal'])

type Events = ReadonlyArray<RunEvent>

// `child`'s events after its newest `ship-launch`, so an earlier launch's stop the relaunched session
// already fixed is never blamed for this ending. The record and the stream outlive a dispatch, so only a
// ship launched since the child's own newest dispatch is this attempt's: an earlier attempt's ended ship
// answers `undefined`, never this park.
function since_ship_launch(events: Events, child: string): Events | undefined {
	const attempt = run_event_scope.since_own_launch(events, child)
	const own = attempt.filter((event) => run_event_scope.issue_named(event) === child)
	const launched_at = own.findLastIndex(
		(event) => event.kind === run_event_stream.EVENT_KIND.SHIP_LAUNCH,
	)

	return launched_at === -1 ? undefined : own.slice(launched_at + 1)
}

// The stopped stage names the cause's short form (`review failed`); a stop text in no known shape is
// still a ship stop.
function stop_cause(stop: RunEvent): StallCause {
	const stage = run_ship_stop_text.reason_of(stop.text)

	return {
		short: stage === undefined ? 'ship stopped' : `${stage} failed`,
		why: `its detached ship stopped and was not fixed: ${stop.text}.`,
	}
}

function cause_of(ending: ShipEnding, events: Events, child: string): StallCause | undefined {
	if (ending === undefined || !ENDED_RESULTS.has(ending.result)) return undefined

	const attempt = since_ship_launch(events, child)
	if (attempt === undefined) return undefined

	const stop = attempt.findLast((event) => event.kind === run_event_stream.EVENT_KIND.SHIP_STOP)

	if (stop !== undefined) return stop_cause(stop)

	return {
		short: `ship ${ending.result}`,
		why: `its detached ship ended ${ending.result} before recording a stopped stage — pnpm josh ship --log ${child}.`,
	}
}

// The ship's cause for `child`'s park, read from the record and the stream this checkout's repository
// keys on, or `undefined` when the child handed nothing to a ship or its ship succeeded.
function cause(child: string, directory: string = process.cwd()): StallCause | undefined {
	const repository = git_common_directory.repository(directory)
	if (repository === undefined) return undefined

	const events = run_event_stream.read_events(run_event_stream.target_of(repository))

	return cause_of(run_ship_detach.read_result(repository, child), events, child)
}

// Whether the ended ship was never answered: a session relaunched to fix a stop writes to the
// transcript after it, so a transcript last written before the newest stop means no fix-up ran — its
// broker or relaunch could not start. A ship with no stop at all ended abnormally only when its supervisor
// died before reaching a stage.
function is_stop_unanswered(
	ending: ShipEnding,
	attempt: Events,
	written_at: number | undefined,
): boolean {
	const stop = attempt.findLast((event) => event.kind === run_event_stream.EVENT_KIND.SHIP_STOP)

	if (stop === undefined) return ending?.result === 'abnormal'

	return written_at !== undefined && written_at < Date.parse(stop.at)
}

// Whether the child's ship ended through an interruption rather than its work, so the child is
// re-dispatched instead of parked.
function interrupted_of(
	ending: ShipEnding,
	events: Events,
	child: string,
	written_at: number | undefined,
): boolean {
	if (ending === undefined || !ENDED_RESULTS.has(ending.result)) return false

	const attempt = since_ship_launch(events, child)

	return attempt !== undefined && is_stop_unanswered(ending, attempt, written_at)
}

function is_interrupted(
	child: string,
	written_at: number | undefined,
	directory: string = process.cwd(),
): boolean {
	const repository = git_common_directory.repository(directory)
	if (repository === undefined) return false

	const events = run_event_stream.read_events(run_event_stream.target_of(repository))

	return interrupted_of(run_ship_detach.read_result(repository, child), events, child, written_at)
}

// Whether the child's ship stopped and the relaunch meant to fix it never ran, read against its
// transcript at `output`. An OpenAI lane is never relaunched — its parent books every stop as an ended
// child — and nothing relaunches a child whose lane is gone, so only an open non-OpenAI lane reads as one.
async function is_unanswered(child: string, output: string | undefined): Promise<boolean> {
	if (output === undefined || !is_interrupted(child, run_ending.written_at(output))) return false

	const lane = await lane_registry.find_open_lane(child)

	return lane !== undefined && !lane_relaunch.is_openai_lane(lane)
}

const run_merge_ship = { cause, cause_of, interrupted_of, is_unanswered }

export { run_merge_ship }
