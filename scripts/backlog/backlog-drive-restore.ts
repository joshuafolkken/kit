import { lane_yield } from '#scripts/lane/lane-yield'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { backlog_offer_exclude } from './backlog-offer-exclude'
import { backlog_triage_withdrawn } from './backlog-triage-withdrawn'

// The `DriveState` lists a seeded drive starts from.
interface LeftOut {
	exclude: Array<string>
	waiting: Array<string>
}

const ISSUE_IN_EVENT = /#([1-9]\d*)\b/u
const SETTLED_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.HUMAN_REVIEW,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.WITHDRAW,
	run_event_stream.EVENT_KIND.OUTAGE,
	run_event_stream.EVENT_KIND.USAGE_LIMIT,
])
const DONE_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.HUMAN_REVIEW,
	run_event_stream.EVENT_KIND.SPLIT,
	run_event_stream.EVENT_KIND.WITHDRAW,
])

function issue_of(event: RunEvent): string | undefined {
	return ISSUE_IN_EVENT.exec(event.text)?.[1]
}

function update_active(active: Set<string>, event: RunEvent): void {
	const issue = issue_of(event)

	if (issue === undefined) return
	if (event.kind === run_event_stream.EVENT_KIND.CHILD_LAUNCH) active.add(issue)
	if (SETTLED_KINDS.has(event.kind)) active.delete(issue)
}

function active_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<string> {
	const active = new Set<string>()

	for (const event of events) update_active(active, event)

	return active
}

// A yield is not among them: it gave its lane back without settling the issue (`lane-yield.ts`).
function settled_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	const settled = run_event_retry
		.current_attempts(events)
		.filter((event) => DONE_KINDS.has(event.kind) && !lane_yield.is_yield(event))

	return new Set(
		settled
			.map((event) => issue_of(event))
			.filter((issue) => issue !== undefined)
			.map(Number),
	)
}

function issues_of_kind(events: ReadonlyArray<RunEvent>, kind: string): ReadonlyArray<string> {
	return events
		.filter((event) => event.kind === kind)
		.map((event) => issue_of(event))
		.filter((issue) => issue !== undefined)
}

// The issues a person withdrew from this run and nobody launched again: the withdrawal leaves the issue
// open for the next run, so this one keeps it out of the offer (joshuafolkken/kit#4365). A lane that
// yielded stays in the run: its retained plan holds it back until the holder ends (`lane-yield.ts`).
// A person's `run:add --retry` after the withdrawal starts a new attempt, so the issue is offered
// again (joshuafolkken/kit#8599).
function withdrawn_issues(events: ReadonlyArray<RunEvent>): ReadonlyArray<string> {
	const current = run_event_retry.current_attempts(events)
	const named = issues_of_kind(current, run_event_stream.EVENT_KIND.WITHDRAW)

	return named.filter((issue) => backlog_triage_withdrawn.is_withdrawn(current, issue))
}

// The exclusion a live drive holds in memory, less the withdrawals a later `run:add --retry` put back
// (joshuafolkken/kit#8599): the drive added them when it collected the withdrawn child.
function without_readmitted(
	exclude: ReadonlyArray<string>,
	events: ReadonlyArray<RunEvent>,
): ReadonlyArray<string> {
	const current = run_event_retry.current_attempts(events)

	return exclude.filter(
		(issue) =>
			!backlog_triage_withdrawn.is_withdrawn(events, issue) ||
			backlog_triage_withdrawn.is_withdrawn(current, issue),
	)
}

// The issues this run found waiting for their measurement sample (joshuafolkken/kit#6503): a drive
// resumed after a hand-back restores its `waiting` list from them, so it measures none of them again.
function waiting_issues(events: ReadonlyArray<RunEvent>): ReadonlyArray<string> {
	return [...new Set(issues_of_kind(events, run_event_stream.EVENT_KIND.SAMPLE_WAIT))]
}

// What a drive seeded from the stream keeps out of its offers: the resume line's exclusion with the
// withdrawals beside it, and the sample waits apart from both.
function left_out(events: ReadonlyArray<RunEvent>, carried: ReadonlyArray<string>): LeftOut {
	const exclude = [...new Set([...carried, ...withdrawn_issues(events)])]

	return { exclude, waiting: [...waiting_issues(events)] }
}

// The offer's exclusion as the stream records it: the merged and withdrawn children, the ones waiting
// for a sample and the ones still in flight — the lists the drive keeps in memory, read by a reader
// that has only the stream (joshuafolkken/kit#4349).
function offer_exclude(events: ReadonlyArray<RunEvent>): ReadonlyArray<string> {
	const merged = issues_of_kind(events, run_event_stream.EVENT_KIND.MERGE)
	const settled = [...merged, ...waiting_issues(events), ...withdrawn_issues(events)]

	return backlog_offer_exclude.exclude_of(settled, active_issues(events))
}

function parked_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	return new Set(
		issues_of_kind(run_event_retry.current_attempts(events), run_event_stream.EVENT_KIND.PARK).map(
			Number,
		),
	)
}

// The parks the drive may retry on its own. One a person withdrew is theirs to put back with
// `run:add --retry`, which re-admits it, so no automatic retry takes it (joshuafolkken/kit#8599).
function retryable_parks(events: ReadonlyArray<RunEvent>): ReadonlySet<number> {
	const withdrawn = new Set(withdrawn_issues(events).map(Number))

	return new Set([...parked_issues(events)].filter((issue) => !withdrawn.has(issue)))
}

// The issues this invocation launched or settled — any other dispatched lane was carried in from an
// earlier invocation.
function mentioned_issues(events: ReadonlyArray<RunEvent>): ReadonlySet<string> {
	const tracked = events.filter(
		(event) =>
			event.kind === run_event_stream.EVENT_KIND.CHILD_LAUNCH || SETTLED_KINDS.has(event.kind),
	)

	return new Set(tracked.map((event) => issue_of(event)).filter((issue) => issue !== undefined))
}

// The lanes still in flight: launched by this invocation and not settled, or dispatched by an earlier
// one and never seen by this one — a lane nobody collects otherwise waits forever.
function restore(
	lanes: ReadonlyArray<string>,
	events: ReadonlyArray<RunEvent>,
	merged_issues: ReadonlyArray<number>,
	dispatched: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
	const active = active_issues(events)
	const mentioned = mentioned_issues(events)
	const carried = new Set(dispatched.filter((issue) => !mentioned.has(issue)))

	return lanes.filter(
		(issue) => (active.has(issue) || carried.has(issue)) && !merged_issues.includes(Number(issue)),
	)
}

export type { LeftOut }
export const backlog_drive_restore = {
	DONE_KINDS,
	active_issues,
	left_out,
	mentioned_issues,
	offer_exclude,
	restore,
	withdrawn_issues,
	without_readmitted,
	settled_issues,
	parked_issues,
	retryable_parks,
}
