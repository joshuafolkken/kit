import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { lane_yield } from '#scripts/lane/lane-yield'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_park_release } from '#scripts/run/park/run-park-release'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_stalled_park } from '#scripts/run/park/run-stalled-park'
import type { DriveState } from './backlog-drive'

// The stop on a yield loop (joshuafolkken/kit#6799). A yielded child stays in the run and is offered
// again once its holder ends, so a holder read wrongly re-dispatches the same issue every offer — on
// 2026-11-08 once a minute, each round spending dozens of GitHub REST calls. Whatever the cause, an
// issue that gave its lane back `YIELD_CAP` times within `WINDOW_MINUTES` is parked `run:stalled` with
// the cause `TRIP_CAUSE` and left out of the pool's offers; the drive's auto-retry re-offers it once the
// window has passed, up to its cap (joshuafolkken/kit#7076, `backlog-drive-stalled-retry.ts`).
//
// **The bounds**: an honest yield waits on a holder lane, which runs far longer than a few minutes, so
// three yields in fifteen are no queue moving — at the observed one a minute the loop stops on its third
// round, before the REST budget feels it.
//
// **The count is the stream's yield notes** (`lane_yield.is_yield_note`), the ones each child's own
// `lane:plan` writes, so a restarted drive still counts the yields before it.

const YIELD_CAP = 3
const WINDOW_MINUTES = 15
const WINDOW_MS = WINDOW_MINUTES * MS_PER_MINUTE
const YIELDED_OUTCOME = 'yielded'
const TRIP_CAUSE = 'yield cap'

interface YieldCapPorts {
	// When this run's lanes on the issue gave their lane back — the stream's yield notes in production.
	yields: (issue: string) => Promise<ReadonlyArray<string>>
	// Parks the issue `run:stalled`, its park event naming `TRIP_CAUSE`, in production.
	park: (issue: string, body: string) => Promise<void>
	now: () => Date
}

function is_tripped(times: ReadonlyArray<string>, now: Date): boolean {
	const since_ms = now.getTime() - WINDOW_MS

	return times.filter((at) => Date.parse(at) >= since_ms).length >= YIELD_CAP
}

function times_of(events: ReadonlyArray<RunEvent>, issue: string): ReadonlyArray<string> {
	return events
		.filter(
			(event) => lane_yield.is_yield_note(event) && run_event_scope.issue_named(event) === issue,
		)
		.map((event) => event.at)
}

function trip_text(issue: string): string {
	return `${issue_cite.plain_for('program', issue)} parked by backlog:drive: it gave its lane back ${String(YIELD_CAP)} times within ${String(WINDOW_MINUTES)} minutes`
}

// A mechanical stop's comment, as `run:merge` writes for one: why, and the next action.
function body_of(issue: string): string {
	return [
		`Parked with \`${RUN_STALLED_LABEL}\`: ${trip_text(issue)}, so the run stopped re-dispatching it.`,
		`- Next: the drive re-offers it itself once ${String(WINDOW_MINUTES)} minutes pass, up to its auto-retry cap; past the cap, find why \`lane:plan\` keeps reading a holder, ${run_stalled.next_step(issue)}.`,
	].join('\n')
}

async function is_capped(issue: string, outcome: string, ports: YieldCapPorts): Promise<boolean> {
	return outcome === YIELDED_OUTCOME && is_tripped(await ports.yields(issue), ports.now())
}

// The state after a collected child: one whose yields reached the cap is parked and excluded.
async function capped(
	issue: string,
	outcome: string,
	state: DriveState,
	ports: YieldCapPorts,
): Promise<DriveState> {
	if (!(await is_capped(issue, outcome, ports))) return state
	await ports.park(issue, body_of(issue))

	return { ...state, exclude: [...state.exclude, issue] }
}

async function yields(issue: string): Promise<ReadonlyArray<string>> {
	return times_of(await run_event_stream_emit.current_events(), issue)
}

// A mechanical stop, not a question: the label and its park event, then the lane's hold released as
// `run:park` releases one (`run-park-release.ts`).
async function park(issue: string, body: string): Promise<void> {
	if (await run_stalled_park.apply(issue, body, TRIP_CAUSE)) await run_park_release.release(issue)
}

const PORTS: Omit<YieldCapPorts, 'now'> = { yields, park }

const backlog_yield_cap = {
	PORTS,
	TRIP_CAUSE,
	WINDOW_MS,
	YIELD_CAP,
	body_of,
	capped,
	is_tripped,
	times_of,
}

export type { YieldCapPorts }
export { backlog_yield_cap }
