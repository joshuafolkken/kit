import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_any_label, NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { DEFAULT_SILENT_MINUTES } from '#scripts/run/run-liveness'
import type { DrivePorts, OfferRead, PassResult } from './backlog-drive'
import { backlog_drive_idle } from './backlog-drive-idle'
import { backlog_overlap } from './backlog-overlap'

// A run held only by paused lanes (joshuafolkken/kit#4270): nothing of this run in flight, nothing
// dispatched, and a lane a person paused past the silent window `run:liveness` waits out declares a
// path an open candidate overlaps. A paused lane holds no lane place (`backlog-occupied.ts`), so that
// overlap is the one way it holds the run; the loop would otherwise watch for ever — a paused lane
// frees nothing until someone resumes it — so it asks the person once. A drained or parked backlog
// with a lane paused somewhere is not held by it, and stays quiet.
//
// **Once per pause episode**: the marker on the stream (`emit_once_since_with`, reset by the
// `lane-state` line every `lane:pause` / `lane:resume` writes) holds every repeat back.

const HOLDING_VERDICTS: ReadonlySet<string> = new Set(['watch', 'wait'])
const BLOCKED_ANSWER = 'blocked'
const PAUSED_TITLE = 'backlogrun held by paused lanes'
const PAUSED_HEAD =
	'No child of this run is running, and these paused lanes hold back work overlapping their paths:'
const PAUSED_RECOVERY =
	'Resume a lane with `pnpm josh lane:resume <N>`, or close it with `pnpm josh lane:close <N>`.'
const SILENT_WINDOW_MS = DEFAULT_SILENT_MINUTES * MS_PER_MINUTE
// A candidate a person set aside waits on that person, not on the paused lane it overlaps.
const SET_ASIDE_LABELS: ReadonlySet<string> = new Set([NEEDS_DECISION_LABEL, RUN_STALLED_LABEL])

interface PausedPorts {
	read_records: () => Promise<ReadonlyArray<LaneStateRecord>>
	// The `auto-ok` pool, or `undefined` when it could not be read.
	read_issues: () => Promise<ReadonlyArray<OpenIssueData> | undefined>
	emit: (compose: () => Promise<string>) => Promise<string | undefined>
	send: (body: string) => Promise<boolean>
	now_ms: () => number
}

// The port is asked on every holding offer with nothing in flight; `notify` decides whether a paused
// lane is what holds it.
function is_held(result: PassResult, read: OfferRead): boolean {
	if (read.answer === BLOCKED_ANSWER) return false

	return HOLDING_VERDICTS.has(read.verdict) && result.state.in_flight.length === 0
}

async function noticed(
	result: PassResult,
	read: OfferRead,
	ports: Pick<DrivePorts, 'paused'>,
): Promise<PassResult> {
	if (is_held(result, read)) await ports.paused()

	return result
}

/** The records paused for at least the silent window at `now_ms`. */
function long_paused(
	records: ReadonlyArray<LaneStateRecord>,
	now_ms: number,
): Array<LaneStateRecord> {
	return records.filter(
		(record) =>
			record.state === 'paused' && now_ms - Date.parse(record.changed_at) >= SILENT_WINDOW_MS,
	)
}

// The open candidates no lane works on and no person set aside — the ones a paused lane can hold.
function waiting_of(
	issues: ReadonlyArray<OpenIssueData>,
	records: ReadonlyArray<LaneStateRecord>,
): Array<number> {
	const lanes = new Set(records.map((record) => record.issue))

	return issues
		.filter((issue) => !lanes.has(String(issue.number)))
		.filter((issue) => !has_any_label(issue.labels, SET_ASIDE_LABELS))
		.map((issue) => issue.number)
}

/** The `paused` records whose declared paths a waiting candidate overlaps. */
function holding(
	paused: ReadonlyArray<LaneStateRecord>,
	issues: ReadonlyArray<OpenIssueData>,
	records: ReadonlyArray<LaneStateRecord>,
): Array<LaneStateRecord> {
	const declared = lane_plan.with_plans(backlog_overlap.declared_of(issues), process.cwd())
	const waiting = waiting_of(issues, records)

	return paused.filter((record) =>
		waiting.some((number) => backlog_overlap.holds(declared, Number(record.issue), number)),
	)
}

async function held_by(ports: PausedPorts): Promise<Array<LaneStateRecord>> {
	const records = await ports.read_records()
	const paused = long_paused(records, ports.now_ms())

	if (paused.length === 0) return []

	const issues = await ports.read_issues()

	return issues === undefined ? [] : holding(paused, issues, records)
}

function describe(records: ReadonlyArray<LaneStateRecord>): string {
	const lines = records.map(
		(record) => `- ${issue_cite.plain(record.issue)} — ${lane_state.paused_note(record) ?? ''}`,
	)

	return [PAUSED_HEAD, ...lines].join('\n')
}

async function read_lane_records(): Promise<ReadonlyArray<LaneStateRecord>> {
	const lanes = await lane_registry.list_lanes()
	const records = await lane_state.read_states(lanes.map((lane) => lane.issue))

	return [...records.values()]
}

async function emit_paused(compose: () => Promise<string>): Promise<string | undefined> {
	const { PAUSED_NOTICE, LANE_STATE } = run_event_stream.EVENT_KIND

	return await run_event_stream_emit.emit_once_since_with(PAUSED_NOTICE, LANE_STATE, compose)
}

async function send_paused(body: string): Promise<boolean> {
	return await telegram_notify.confirm({
		issue_title: PAUSED_TITLE,
		body,
		recovery: PAUSED_RECOVERY,
		recommended: 'Resume the paused lanes with `pnpm josh lane:resume <N>`',
		alternatives: ['Close the paused lanes with `pnpm josh lane:close <N>`'],
	})
}

const DEFAULT_PORTS: PausedPorts = {
	read_records: read_lane_records,
	read_issues: backlog_drive_idle.read_pool,
	emit: emit_paused,
	send: send_paused,
	now_ms: () => Date.now(),
}

// The production `paused` port. Best-effort, as the idle port is: a failed read or send is dropped.
async function notify(ports: PausedPorts = DEFAULT_PORTS): Promise<void> {
	try {
		const paused = await held_by(ports)

		if (paused.length === 0) return

		const body = await ports.emit(async () => describe(paused))

		if (body !== undefined) await ports.send(body)
	} catch {
		// Reporting is best-effort: a paused notice we could not read or send is dropped.
	}
}

const backlog_drive_paused = { noticed, notify }

export { backlog_drive_paused }
export type { PausedPorts }
