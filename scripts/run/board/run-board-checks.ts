import { run_event_checks, type PrChecks } from '#scripts/run/event/run-event-checks'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// Each child's newest `pr-checks` line — its pull request's CI counts and CodeRabbit's state as
// `josh followup` last polled them (joshuafolkken/kit#3770). Read from the stream alone, so a redraw
// asks GitHub nothing.

interface HeldChecks {
	checks: PrChecks
	at_ms: number
}

const { PR_CHECKS } = run_event_stream.EVENT_KIND

function held_of(event: RunEvent): HeldChecks | undefined {
	const checks = event.kind === PR_CHECKS ? run_event_checks.checks_of(event.text) : undefined

	return checks === undefined ? undefined : { checks, at_ms: Date.parse(event.at) }
}

// The stream's bound reorders its lines, so the newest is the latest `at`, not the last line.
function is_newer(held: HeldChecks, current: HeldChecks | undefined): boolean {
	return current === undefined || held.at_ms >= current.at_ms
}

function newest_of(events: ReadonlyArray<RunEvent>): ReadonlyMap<number, PrChecks> {
	const newest = new Map<number, HeldChecks>()

	for (const event of events) {
		const held = held_of(event)
		const issue = Number(run_event_scope.issue_named(event))

		if (held !== undefined && is_newer(held, newest.get(issue))) newest.set(issue, held)
	}

	return new Map([...newest].map(([issue, held]) => [issue, held.checks]))
}

const run_board_checks = { newest_of }

export { run_board_checks }
