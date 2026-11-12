import { lane_implement_signals_record } from '#scripts/lane/lane-implement-signals-record'
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
	[KIND.PR_OPENED]: STEP.FOLLOWUP,
}

// `line` is the printed action or verdict, `last_event` the newest event the position was read from.
function step_of(line: string, last_event = ''): FullrunStep | undefined {
	return VERDICT_STEPS[line] ?? EVENT_STEPS[last_event]
}

interface ProgressIo {
	step: (issue: string, step: FullrunStep) => Promise<void>
	signals: (issue: string) => Promise<void>
}

const STREAM_IO: ProgressIo = {
	step: async (issue, step) => {
		await run_event_step.record(issue, step)
	},
	signals: lane_implement_signals_record.record,
}

// A position that names no step writes nothing; the gate also writes the implement signals
// (joshuafolkken/kit#6983).
async function record(
	issue: string,
	line: string,
	last_event: string | undefined,
	io: ProgressIo = STREAM_IO,
): Promise<void> {
	const step = step_of(line, last_event)

	if (step === undefined) return

	await io.step(issue, step)
	if (step === STEP.GATE) await io.signals(issue)
}

const run_step_progress = { record, step_of }

export { run_step_progress }
