import { auto_ok_author } from '#scripts/auto-ok/auto-ok-author'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_any_label, NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { DrivePorts, DriveState, OfferRead, PassResult } from './backlog-drive'

// The one notification an idle backlogrun sends (joshuafolkken/kit#4015): a watch with no child running
// is where a person's hand is wanted — a parked issue to decide, a dated one to wait out, or the next run
// to start. A stall was notified instead and reached nobody with anything to do, since the next dispatch
// resolved it; this fires only once nothing is left for the loop itself to do.
//
// **Once per idle episode**: the loop asks once a minute while it watches, so the marker on the stream
// (`emit_once_since_with`, reset by a `child-launch`) holds every repeat back, and the pool is read only
// for an episode that is new.

const WATCH_VERDICT = 'watch'
const BLOCKED_ANSWER = 'blocked'
const DECISION_HEADING = `Waiting on a decision (${NEEDS_DECISION_LABEL}):`
const STALLED_HEADING = `Stalled mechanically (${RUN_STALLED_LABEL}):`
const UNTRUSTED_HEADING = 'Waiting on a person to vouch for the body (author without write access):'
const IDLE_HEAD = 'No child running and nothing left to dispatch.'
const IDLE_RECOVERY =
	'Decide the parked issues, fix and release the stalled ones, or start the next run with `backlogrun`.'

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
function is_idle(result: PassResult, read: OfferRead): boolean {
	if (read.answer === BLOCKED_ANSWER) return false

	return read.verdict === WATCH_VERDICT && result.state.in_flight.length === 0
}

async function noticed(
	result: PassResult,
	read: OfferRead,
	ports: Pick<DrivePorts, 'idle'>,
): Promise<PassResult> {
	if (is_idle(result, read)) await ports.idle(result.state)

	return result
}

function cited(issue: OpenIssueData, suffix = ''): string {
	return `- ${issue_cite.plain(issue.number)} ${issue.title}${suffix}`
}

// The cited issues carrying one park label. `needs-decision` and `run:stalled` are listed apart: one asks
// a person for a judgement, the other for a mechanical fix (`issue-labels.ts`).
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

function remaining_lines(reading: IdleReading): Array<string> {
	if (reading.issues === undefined) return ['Remaining issues: unreadable']

	const lines = [
		...section(DECISION_HEADING, labelled_lines(reading.issues, NEEDS_DECISION_LABEL)),
		...section(STALLED_HEADING, labelled_lines(reading.issues, RUN_STALLED_LABEL)),
		...section(UNTRUSTED_HEADING, untrusted_lines(reading.issues)),
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

const backlog_drive_idle = { describe, noticed, notify, read_pool }

export { backlog_drive_idle }
export type { IdlePorts }
