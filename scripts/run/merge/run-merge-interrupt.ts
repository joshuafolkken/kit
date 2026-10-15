import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_reap } from '#scripts/lane/lane-reap'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_label } from '#scripts/run/run-label'
import { run_liveness } from '#scripts/run/run-liveness'
import { run_merge_steps, type MergeContext } from './run-merge-steps'

// Whether a returned child's unit was killed rather than failed — joshuafolkken/kit#3884. A session
// that ends on its own writes an exit record as its transcript's last event; one killed with the session
// that ran it (a closed terminal, an ended parent) stops mid-turn with none. That is not the child's
// failure, so `run:merge` releases it to be dispatched again without counting it.
//
// **Once per invocation**: a child this invocation already released for an interruption is classified
// as failed the second time, so a unit that dies the same way on every dispatch is parked rather than
// re-dispatched for good.

const RUNNING_RESULT = 'running'

// The transcript's last session wrote events but no exit record. An unreadable transcript, or one with
// no agent event at all, says nothing and is not read as an interruption.
function is_cut_short(output: string | undefined): boolean {
	if (output === undefined) return false

	return run_liveness.read_agent_state(output)?.result === RUNNING_RESULT
}

function was_interrupted(events: ReadonlyArray<RunEvent>, child: string): boolean {
	return events.some(
		(event) =>
			event.kind === run_event_stream.EVENT_KIND.INTERRUPT &&
			run_event_scope.issue_named(event) === child,
	)
}

async function is_interrupted(child: string, output: string | undefined): Promise<boolean> {
	if (!is_cut_short(output)) return false

	return !was_interrupted(await run_event_stream_emit.current_events(), child)
}

// Release an interrupted child: end any process its unit left — before the re-dispatch launches a
// second one — drop its `in-progress` so it is offerable again, and record the interruption so a second
// one in this invocation is a failure. Nothing is counted. Returns the carry record when this session
// does not own it, `undefined` once released.
async function release(ctx: MergeContext): Promise<RunCarry | undefined> {
	const refused = await run_merge_steps.refused_carry(ctx)

	if (refused !== undefined) return refused

	lane_reap.reap_child(ctx.child)
	await run_label.unmark(ctx.child)
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.INTERRUPT,
		`${issue_cite.plain(ctx.child)} interrupted (re-dispatchable)`,
	)

	return undefined
}

const run_merge_interrupt = { is_interrupted, release }

export { run_merge_interrupt }
