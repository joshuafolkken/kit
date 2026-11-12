import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_ledger, type LedgerEntry, type StageEntry } from './lane-ledger'
import { lane_stop_stats } from './lane-stop-stats'

// The bounded board stream is not a historical stage store. Completed ledger intervals survive
// compaction and archive rotation; merge them with surviving events before attributing lane time.
const { EVENT_KIND } = run_event_stream
const { PHASE, STAGE } = run_ship_stage
const SHIP_STAGES: ReadonlySet<string> = new Set([
	...Object.values(STAGE),
	lane_ledger.PRE_DETACH_STAGE,
])

function is_ship(entry: LedgerEntry, issue: number): entry is StageEntry {
	return (
		entry.kind === lane_ledger.KIND.STAGE && entry.issue === issue && SHIP_STAGES.has(entry.stage)
	)
}

function event_at(at_ms: number, issue: number, words: string): RunEvent {
	return {
		pos: 0,
		at: new Date(at_ms).toISOString(),
		kind: EVENT_KIND.SHIP_STAGE,
		text: `${issue_cite.plain_for('program', issue)} ${words}`,
	}
}

function interval_events(entry: StageEntry, issue: number): Array<RunEvent> {
	const end_ms = Date.parse(entry.at)
	if (!Number.isFinite(end_ms) || entry.elapsed_ms <= 0) return []

	return [
		event_at(end_ms - entry.elapsed_ms, issue, `${entry.stage} ${PHASE.START}`),
		event_at(end_ms, issue, `${entry.stage} ${PHASE.DONE}`),
	]
}

function is_lane_ship(event: RunEvent, issue: number): boolean {
	return event.kind === EVENT_KIND.SHIP_STAGE && lane_stop_stats.issue_of(event) === issue
}

function change(active: Map<string, RunEvent>, event: RunEvent): void {
	if (event.kind === EVENT_KIND.STOP) {
		active.clear()

		return
	}

	const { stage, phase } = run_ship_stage.words_of(event.text)
	if (phase === PHASE.SKIPPED) return
	if (phase === PHASE.START) active.set(stage, event)
	else active.delete(stage)
}

// Parallel stages occupy one wall-clock interval. The most recently started stage owns an overlap;
// when it ends, the still-running stage resumes rather than opening a false gap.
function exclusive(events: ReadonlyArray<RunEvent>, issue: number): Array<RunEvent> {
	const active = new Map<string, RunEvent>()

	return events.map((event) => {
		change(active, event)
		const latest = [...active.values()].at(-1)
		if (latest === undefined) return event
		const { stage } = run_ship_stage.words_of(latest.text)

		return event_at(Date.parse(event.at), issue, `${stage} ${PHASE.START}`)
	})
}

function stop_events(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<RunEvent> {
	return entries.flatMap((entry) =>
		entry.kind === lane_ledger.KIND.STOP && entry.issue === issue
			? { ...event_at(Date.parse(entry.at), issue, entry.reason), kind: EVENT_KIND.STOP }
			: [],
	)
}

function of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): ReadonlyArray<RunEvent> {
	const restored = entries
		.filter((entry) => is_ship(entry, issue))
		.flatMap((entry) => interval_events(entry, issue))
	const ship = [
		...events.filter((event) => is_lane_ship(event, issue)),
		...restored,
		...stop_events(entries, issue),
	].toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))

	return [
		...events.filter((event) => !is_lane_ship(event, issue)),
		...exclusive(ship, issue),
	].toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
}

const lane_stage_events = { of }

export { lane_stage_events }
