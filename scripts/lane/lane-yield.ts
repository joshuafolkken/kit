import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// A lane child that gives its lane back (joshuafolkken/kit#4926): `lane:plan` found a running lane that
// planned one of its files first, so instead of polling for the holder to end while its seat stays taken,
// it notes its yield on the stream and ends. `run:merge` books it `yielded` — neither a merge, a failure
// nor an outage — and closes the lane through `lane:withdraw`'s path, named as this withdrawer.
//
// **The yield is a `note`, not a `withdraw`**: a `withdraw` event says the lane is already closed, and
// the readers of the stream (`backlog-drive-restore.ts`, the `run:wake` sweep, `run:tidy`) act on that.
// The yielding child cannot close its own lane, so its issue stays in flight until `run:merge` does.
//
// **Unlike a person's withdrawal, a yield does not take the issue out of the run.** Its plan outlives the
// lane (`lane-plan.ts` → `release`), so `backlog:next` holds it back on that plan while the holder runs
// and offers it again once the holder's lane ends; `backlog-drive-restore.ts` reads `is_yield` to leave
// the closing withdrawal out of the withdrawn and the settled issues.

// The reason `run:merge` closes a yielded lane with.
const YIELD_REASON = 'it gave its lane back to an earlier lane holding one of its planned files'

const YIELD_MARK = ' yielded its lane: '
const NAMED_ISSUE = /#([1-9]\d*)\b/gu

const YIELD_TEXT = {
	name: 'its own lane:plan',
	cause: '`lane:plan` gave its lane back to an earlier lane holding one of its planned files',
	closed_head: 'Its lane was given back by `pnpm josh lane:plan` after the Issue was closed.',
	open_head:
		'Gave its lane back: `pnpm josh lane:plan` found an earlier lane holding one of its planned files.',
	open_tail:
		'The lane closed before any implementation edit. The Issue stays in the run: it is offered again once the holding lane ends, keeping its place in line.',
	stays: 'The Issue stays in the run: it is offered again once the holding lane ends.',
} as const

// Where in the lane the yield fell, one word on the note, kept for a later count of how many the entry
// probe caught before the investigation (joshuafolkken/kit#5211): `entry` from `run:entry`, `summary` from the
// `lane:plan` a child runs once its work summary is set.
type YieldAt = 'entry' | 'summary'

const YIELD_AT_MARK = ' · at: '

async function record_yield(issue: number, reason: string, at: YieldAt): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.NOTE,
		`${issue_cite.plain_for('program', String(issue))}${YIELD_MARK}${reason}${YIELD_AT_MARK}${at}`,
	)
}

function is_yield_note(event: RunEvent): boolean {
	return event.kind === run_event_stream.EVENT_KIND.NOTE && event.text.includes(YIELD_MARK)
}

// Whether `event` is the withdrawal `run:merge` closed a yielded lane with, rather than one that takes
// the issue out of the run.
function is_yield(event: RunEvent): boolean {
	return (
		event.kind === run_event_stream.EVENT_KIND.WITHDRAW &&
		event.text.includes(` withdrawn by ${YIELD_TEXT.name}:`)
	)
}

// An event that decides whether the issue's newest launch yielded: the launch, the yield, or a
// withdrawal that is not the yield's own close.
function is_deciding(event: RunEvent, issue: string): boolean {
	if (run_event_scope.issue_named(event) !== issue) return false
	if (event.kind === run_event_stream.EVENT_KIND.CHILD_LAUNCH) return true

	return (
		is_yield_note(event) ||
		(event.kind === run_event_stream.EVENT_KIND.WITHDRAW && !is_yield(event))
	)
}

// Whether the issue's newest launch gave its lane back, and no one withdrew it since.
function latest_yield(events: ReadonlyArray<RunEvent>, issue: string): RunEvent | undefined {
	const newest = events.findLast((event) => is_deciding(event, issue))

	return newest !== undefined && is_yield_note(newest) ? newest : undefined
}

function is_yielded(events: ReadonlyArray<RunEvent>, issue: string): boolean {
	return latest_yield(events, issue) !== undefined
}

// The overlap text names the holder last, after the yielding issue's own citations.
function holder_of(note: RunEvent): number | undefined {
	const yielder = Number(run_event_scope.issue_named(note))

	return [...note.text.matchAll(NAMED_ISSUE)]
		.map((match) => Number(match[1]))
		.findLast((issue) => issue !== yielder)
}

function withdraw_reason(events: ReadonlyArray<RunEvent>, issue: string): string {
	const note = latest_yield(events, issue)
	const holder = note === undefined ? undefined : holder_of(note)
	// Stored in the withdrawal event; its renderer supplies session citations.
	const holding_issue = issue_cite.plain_for('program', holder ?? '')

	return holder === undefined
		? YIELD_REASON
		: `yielded to ${holding_issue}, which held one of its planned files; re-queues after ${holding_issue} merges`
}

const lane_yield = {
	YIELD_REASON,
	YIELD_TEXT,
	holder_of,
	is_yield,
	is_yield_note,
	is_yielded,
	record_yield,
	withdraw_reason,
}

export { lane_yield }
export type { YieldAt }
