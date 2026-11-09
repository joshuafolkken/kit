import { run_entry } from '#scripts/run/entry/run-entry'
import { run_event_step, type FullrunStep } from '#scripts/run/event/run-event-step'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_step } from './run-step'

// The fullrun step a computed position stands at, written as a `step` event (joshuafolkken/kit#6598).
// **It reads the position `run:step` and `run:entry` already computed**, never decides one: the
// pre-implementation verdict names the step before the first edit, and the newest event the one after.

const { STEP } = run_event_step
const KIND = run_event_stream.EVENT_KIND

const VERDICT_STEPS: Readonly<Partial<Record<string, FullrunStep>>> = {
	[run_step.UPDATE_DEPS]: STEP.UPDATE_DEPS,
	[run_step.IMPLEMENT]: STEP.IMPLEMENT,
	[run_step.HUMAN_REVIEW]: STEP.IMPLEMENT,
	[run_entry.GATE_VERDICT]: STEP.GATE,
}

const EVENT_STEPS: Readonly<Partial<Record<string, FullrunStep>>> = {
	[KIND.REVIEW_ROUND]: STEP.GATE,
	[KIND.SHIP_LAUNCH]: STEP.GATE,
	[KIND.SHIP_STOP]: STEP.GATE,
	[KIND.PR_OPENED]: STEP.FOLLOWUP,
}

// `line` is the printed action or verdict, `last_event` the newest event the position was read from.
function step_of(line: string, last_event = ''): FullrunStep | undefined {
	return VERDICT_STEPS[line] ?? EVENT_STEPS[last_event]
}

// A position that names no step writes nothing.
async function record(issue: string, line: string, last_event: string | undefined): Promise<void> {
	const step = step_of(line, last_event)

	if (step !== undefined) await run_event_step.record(issue, step)
}

const run_step_progress = { record, step_of }

export { run_step_progress }
