import { auto_ok_author } from '#scripts/auto-ok/auto-ok-author'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_human_stops, type HumanStop } from '#scripts/issue/issue-human-stops'
import { has_any_label, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_board_seat } from '#scripts/run/board/run-board-seat'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { DrivePorts, DriveState, OfferRead, PassResult } from './backlog-drive'
import { backlog_ready } from './backlog-ready'

// The one notification an idle backlogrun sends (joshuafolkken/kit#4015): a watch with no child running
// is where a person's hand is wanted — a parked issue to decide, a dated one to wait out, or the next run
// to start. A stall was notified instead and reached nobody with anything to do, since the next dispatch
// resolved it; this fires only once nothing is left for the loop itself to do.
//
// **Once per idle episode**: the loop asks every offer interval while it watches, so the marker on the stream
// (`emit_once_since_with`, reset by a `child-launch`) holds every repeat back, and the pool is read only
// for an episode that is new.

const WATCH_VERDICT = 'watch'
const BLOCKED_ANSWER = 'blocked'
const STALLED_HEADING = `Stalled mechanically (${RUN_STALLED_LABEL}):`
const IDLE_HEAD = 'No child running and nothing left to dispatch.'
const IDLE_RECOVERY =
	'Act on each issue under its heading, fix and release the stalled ones, or start the next run with `backlogrun`.'
const SHORTFALL_RECOVERY =
	'Opt more issues in with `auto-ok`, or decide the parked ones `pnpm josh run:board --chat` lists.'

interface IdlePorts {
	read_issues: () => Promise<ReadonlyArray<OpenIssueData> | undefined>
	emit: (compose: () => Promise<string>) => Promise<string | undefined>
	send: (body: string) => Promise<boolean>
	now_ms: () => number
}

interface IdleReading {
	merged: number
	// The `auto-ok` pool, or `undefined` when it could not be read.
	issues: ReadonlyArray<OpenIssueData> | undefined
	now_ms: number
}

// Idle is any watch with nothing in flight, not only the drain: a watch over parked or dated issues
// alone waits on a person just the same. A `blocked` watch is not: with nothing in flight it is only a
// transient `retry`, which says nothing about whether work is left to dispatch.
function is_watch(read: OfferRead): boolean {
	return read.answer !== BLOCKED_ANSWER && read.verdict === WATCH_VERDICT
}

// Only these answers say no issue is ready; a watch draining a run that is ending (`--max` reached,
// idle expired) still has `candidates`, and an `unreadable` listing says nothing either way.
const NOTHING_READY_ANSWERS: ReadonlySet<string | undefined> = new Set(['exhausted', 'parked'])

// A watch with a child still running and nothing ready is the shortfall (joshuafolkken/kit#8332): a
// free lane waits on a person to supply work — the idle notice says the same once nothing runs, so the
// two never fire on one pass.
async function notice_running(
	state: DriveState,
	read: OfferRead,
	ports: Pick<DrivePorts, 'shortfall'>,
): Promise<void> {
	if (NOTHING_READY_ANSWERS.has(read.answer)) await ports.shortfall(state)
}

async function noticed(
	result: PassResult,
	read: OfferRead,
	ports: Pick<DrivePorts, 'idle' | 'shortfall'>,
): Promise<PassResult> {
	if (!is_watch(read)) return result

	await (result.state.in_flight.length === 0
		? ports.idle(result.state)
		: notice_running(result.state, read, ports))

	return result
}

function cited(issue: OpenIssueData, suffix = ''): string {
	return `- ${issue_cite.plain_for('telegram', issue.number)} ${issue.title}${suffix}`
}

// The cited issues carrying one label. A person's stops and `run:stalled` are listed apart: one asks
// a person, the other for a mechanical fix (`issue-labels.ts`).
function labelled_lines(issues: ReadonlyArray<OpenIssueData>, label: string): Array<string> {
	return issues
		.filter((issue) => has_any_label(issue.labels, new Set([label])))
		.map((issue) => cited(issue))
}

// `backlog:next` holds these for a person exactly as it does a parked one (joshuafolkken/kit#4633).
function untrusted_lines(issues: ReadonlyArray<OpenIssueData>): Array<string> {
	return issues
		.filter((issue) => !auto_ok_author.is_author_trusted(issue))
		.map((issue) => cited(issue))
}

function dated_lines(issues: ReadonlyArray<OpenIssueData>, now_ms: number): Array<string> {
	const lines: Array<string> = []

	for (const issue of issues) {
		const reason = issue_not_before.waiting_reason(issue.body, now_ms)

		if (reason !== undefined) lines.push(cited(issue, ` — ${reason}`))
	}

	return lines
}

function section(heading: string, lines: ReadonlyArray<string>): Array<string> {
	return lines.length === 0 ? [] : [heading, ...lines]
}

function waiting_lines(issues: ReadonlyArray<OpenIssueData>, stop: HumanStop): Array<string> {
	if (stop.label !== undefined) return labelled_lines(issues, stop.label)

	return stop.key === issue_human_stops.UNTRUSTED_AUTHOR_KEY ? untrusted_lines(issues) : []
}

// The person's stops come from their single list (`issue-human-stops.ts`), so a new one is listed here too.
function person_lines(issues: ReadonlyArray<OpenIssueData>): Array<string> {
	return issue_human_stops
		.idle_stops()
		.flatMap((stop) => section(stop.idle_heading ?? stop.key, waiting_lines(issues, stop)))
}

function remaining_lines(reading: IdleReading): Array<string> {
	if (reading.issues === undefined) return ['Remaining issues: unreadable']

	const lines = [
		...person_lines(reading.issues),
		...section(STALLED_HEADING, labelled_lines(reading.issues, RUN_STALLED_LABEL)),
		...section('Waiting on a date:', dated_lines(reading.issues, reading.now_ms)),
	]

	return lines.length === 0 ? ['Nothing parked or dated is left.'] : lines
}

function describe(reading: IdleReading): string {
	const merged = `Merged this run: ${String(reading.merged)}`

	return [IDLE_HEAD, merged, ...remaining_lines(reading)].join('\n')
}

async function read_pool(): Promise<ReadonlyArray<OpenIssueData> | undefined> {
	const read = await auto_ok_cli.fetch_opted_in()

	return read.kind === 'read' ? read.issues : undefined
}

async function emit_idle(compose: () => Promise<string>): Promise<string | undefined> {
	const { IDLE_NOTICE, CHILD_LAUNCH } = run_event_stream.EVENT_KIND

	return await run_event_stream_emit.emit_once_since_with(IDLE_NOTICE, CHILD_LAUNCH, compose)
}

async function send_idle(body: string): Promise<boolean> {
	return await telegram_notify.idle({ body, recovery: IDLE_RECOVERY })
}

const DEFAULT_PORTS: IdlePorts = {
	read_issues: read_pool,
	emit: emit_idle,
	send: send_idle,
	now_ms: () => Date.now(),
}

// The production `idle` port. Best-effort: the loop is only reporting, so a failed read or send is
// dropped rather than raised into the watch.
async function notify(state: DriveState, ports: IdlePorts = DEFAULT_PORTS): Promise<void> {
	try {
		const body = await ports.emit(async () =>
			describe({
				merged: state.exclude.length,
				issues: await ports.read_issues(),
				now_ms: ports.now_ms(),
			}),
		)

		if (body !== undefined) await ports.send(body)
	} catch {
		// Reporting is best-effort: an idle notice we could not read or send is dropped.
	}
}

interface ShortfallPorts {
	free_lanes: () => Promise<number>
	emit: (compose: () => Promise<string>) => Promise<string | undefined>
	send: (body: string) => Promise<boolean>
}

function describe_shortfall(running: number, free: number): string {
	return `${run_board_seat.NO_CANDIDATE}: ${String(free)} lane(s) free, ${String(running)} running.`
}

async function emit_shortfall(compose: () => Promise<string>): Promise<string | undefined> {
	const { SHORTFALL_NOTICE, CHILD_LAUNCH } = run_event_stream.EVENT_KIND

	return await run_event_stream_emit.emit_once_since_with(SHORTFALL_NOTICE, CHILD_LAUNCH, compose)
}

async function send_shortfall(body: string): Promise<boolean> {
	return await telegram_notify.shortfall({ body, recovery: SHORTFALL_RECOVERY })
}

const SHORTFALL_PORTS: ShortfallPorts = {
	free_lanes: backlog_ready.drive_free_lane_count,
	emit: emit_shortfall,
	send: send_shortfall,
}

// An unreadable lane count reads as none free: no notice rather than a guess.
async function read_free(ports: ShortfallPorts): Promise<number> {
	try {
		return await ports.free_lanes()
	} catch {
		return 0
	}
}

// The production `shortfall` port, best-effort as `notify` is. Lanes all taken is no shortfall, so the
// marker is left unwritten and the episode stays open until a lane frees.
async function shortfall(
	state: DriveState,
	ports: ShortfallPorts = SHORTFALL_PORTS,
): Promise<void> {
	const free = await read_free(ports)

	if (free === 0) return

	try {
		const body = await ports.emit(async () => describe_shortfall(state.in_flight.length, free))

		if (body !== undefined) await ports.send(body)
	} catch {
		// Reporting is best-effort: a shortfall notice we could not read or send is dropped.
	}
}

const backlog_drive_idle = { describe, describe_shortfall, noticed, notify, read_pool, shortfall }

export { backlog_drive_idle }
export type { IdlePorts, ShortfallPorts }
