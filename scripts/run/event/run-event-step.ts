import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_scope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// The fullrun step an issue's run reached, written to the stream as one `step` event each time it
// changes (joshuafolkken/kit#6598). The steps are `fullrun-steps.md`'s numbered list; only those a run's
// position names are written — the steps before the implementation leave no record to read them from.
// `run:board` draws the newest one as written, so nothing is guessed from the clock.

interface FullrunStep {
	number: number
	name: string
}

const TOTAL_STEPS = 8
const STEP_KIND = run_event_stream.EVENT_KIND.STEP

const STEP = {
	UPDATE_DEPS: { number: 4, name: 'update-deps' },
	IMPLEMENT: { number: 5, name: 'implement' },
	GATE: { number: 6, name: 'gate' },
	FOLLOWUP: { number: 7, name: 'followup' },
} as const satisfies Record<string, FullrunStep>

const WORD_SEPARATOR = ' '
// `#<N> step <n>/<total> <name>`: the words after the issue, and the name after the count.
const WORDS_START = 1
const NAME_START = 3

function text_of(issue: string, step: FullrunStep): string {
	const cite = issue_cite.plain_for('program', issue)

	return `${cite} step ${String(step.number)}/${String(TOTAL_STEPS)} ${step.name}`
}

function words_after(event: RunEvent, start: number): string {
	return event.text.split(WORD_SEPARATOR).slice(start).join(WORD_SEPARATOR)
}

// The words `run:board` draws: `step 6/8 gate`.
function words_of(event: RunEvent): string {
	return words_after(event, WORDS_START)
}

function name_of(event: RunEvent): string {
	return words_after(event, NAME_START)
}

function is_step_of(event: RunEvent, issue: string): boolean {
	return event.kind === STEP_KIND && run_event_scope.issue_named(event) === issue
}

function is_latest(events: ReadonlyArray<RunEvent>, issue: string, text: string): boolean {
	return events.findLast((event) => is_step_of(event, issue))?.text === text
}

interface StepIo {
	read: () => Promise<ReadonlyArray<RunEvent>>
	emit: (kind: string, text: string) => Promise<void>
}

const STREAM_IO: StepIo = {
	read: run_event_stream_emit.all_events,
	emit: run_event_stream_emit.emit,
}

// Every `run:step` asks again, so a step already the issue's newest is not written twice. Best-effort,
// as every append to the stream is.
async function record(issue: string, step: FullrunStep, io: StepIo = STREAM_IO): Promise<void> {
	const text = text_of(issue, step)

	if (is_latest(await io.read(), issue, text)) return

	await io.emit(STEP_KIND, text)
}

const run_event_step = { STEP, name_of, record, text_of, words_of }

export { run_event_step }
export type { FullrunStep, StepIo }
