import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_yield } from '#scripts/lane/lane-yield'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { DriveState } from './backlog-drive'

// The stop on a yield loop (joshuafolkken/kit#6799). A yielded child stays in the run and is offered
// again once its holder ends, so a holder read wrongly re-dispatches the same issue every offer — on
// 2026-11-08 once a minute, each round spending dozens of GitHub REST calls. Whatever the cause, an
// issue that gave its lane back `YIELD_CAP` times within `WINDOW_MINUTES` is parked for a person and
// left out of the rest of the run, and the trip is noted on the run's event stream.
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
const should_forward_stderr = true
const PERSON_PERMISSION = '   - 必要な権限: 人'

interface YieldCapPorts {
	// When this run's lanes on the issue gave their lane back — the stream's yield notes in production.
	yields: (issue: string) => Promise<ReadonlyArray<string>>
	// Parks the issue for a person and notes the trip on the stream in production.
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
	return `${issue_cite.plain(issue)} parked by backlog:drive: it gave its lane back ${String(YIELD_CAP)} times within ${String(WINDOW_MINUTES)} minutes`
}

// A person's park (`run_park_body`): no option is the parent's own, so `backlog:drive` never takes one.
function body_of(issue: string): string {
	const release = `\`pnpm josh run:park ${issue} --clear\``

	return [
		`${trip_text(issue)}, so the run stopped re-dispatching it.`,
		`This run and its \`resume:\` line keep it excluded, so a release takes effect in a fresh \`backlog:drive\` without \`--exclude ${issue}\`.`,
		'',
		'### 選択肢',
		`1. Find why \`lane:plan\` keeps reading a holder, then release it with ${release}`,
		'   - 層: B',
		PERSON_PERMISSION,
		`2. Release it as it is with ${release}`,
		'   - 層: A',
		PERSON_PERMISSION,
		'### 推奨',
		'1 a release before the cause is known loops again',
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

async function park(issue: string, body: string): Promise<void> {
	const argv = ['run:park', issue, '--body', body]
	const result = await josh_command.josh_run(argv, should_forward_stderr)

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.NOTE,
		`${trip_text(issue)} · run:park exit: ${String(result.code)}`,
	)
}

const PORTS: Omit<YieldCapPorts, 'now'> = { yields, park }

const backlog_yield_cap = {
	PORTS,
	WINDOW_MS,
	YIELD_CAP,
	body_of,
	capped,
	is_tripped,
	times_of,
}

export type { YieldCapPorts }
export { backlog_yield_cap }
