import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'

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

function cause_of(ending: ShipEnding, events: Events, child: string): string | undefined {
	if (ending === undefined || !ENDED_RESULTS.has(ending.result)) return undefined

	const attempt = since_ship_launch(events, child)
	if (attempt === undefined) return undefined

	const stop = attempt.findLast((event) => event.kind === run_event_stream.EVENT_KIND.SHIP_STOP)

	if (stop !== undefined) return `its detached ship stopped and was not fixed: ${stop.text}.`

	return `its detached ship ended ${ending.result} before recording a stopped stage — pnpm josh ship --log ${child}.`
}

// The ship's cause for `child`'s park, read from the record and the stream this checkout's repository
// keys on, or `undefined` when the child handed nothing to a ship or its ship succeeded.
function cause(child: string, directory: string = process.cwd()): string | undefined {
	const repository = git_common_directory.repository(directory)
	if (repository === undefined) return undefined

	const events = run_event_stream.read_events(run_event_stream.target_of(repository))

	return cause_of(run_ship_detach.read_result(repository, child), events, child)
}

const run_merge_ship = { cause, cause_of }

export { run_merge_ship }
