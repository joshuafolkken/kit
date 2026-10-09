import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_scope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// The `plan` event `run:board` draws 📝 from, written by code rather than by a step a child runs by hand,
// which children skip — and every `run:planned` issue's entry starts past the plan. Two callers write
// it: `run:entry` when a planned issue is claimed, and the first implementation edit of a lane child,
// which is where the Step 0 work summary falls due. **Once per launch of the issue**, so the second
// of the two adds nothing, while a re-dispatched child — whose launch restarts its `run:board` track —
// writes its own.

const KIND = run_event_stream.EVENT_KIND.PLAN
const PLAN_VERB = 'planned'

function plan_text(issue: string): string {
	return `${PLAN_VERB} ${issue_cite.plain(issue)}`
}

function has_plan(events: ReadonlyArray<RunEvent>, issue: string): boolean {
	return run_event_scope
		.since_own_launch(events, issue)
		.some((event) => event.kind === KIND && run_event_scope.issue_named(event) === issue)
}

/**
 * Append the issue's `plan` event unless its newest launch already carries one. Best-effort
 * like every emit: a failed read is an empty invocation, a failed append is swallowed.
 */
async function emit_plan(issue: string): Promise<void> {
	if (has_plan(await run_event_stream_emit.invocation_or_all_events(), issue)) return

	await run_event_stream_emit.emit(KIND, plan_text(issue))
}

const run_event_plan = { emit_plan, plan_text }

export { run_event_plan }
