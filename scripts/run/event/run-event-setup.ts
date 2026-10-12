import { issue_cite } from '#scripts/issue/issue-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// The stages a run passes between `josh backlogrun` and its first child, each written to the stream as
// one `setup` event by the step that enters it. **The text is the stage's own words**: `run:board` draws
// it as written, so the message a person reads and the `💓` beside it come from one event and cannot
// disagree. Only a lane opening names an issue, which is how a reader tells it from the stages before it.

const STAGE = {
	// `josh backlogrun` started the parent session, which is reading its procedure.
	STARTING: 'starting session',
	// `run:carry --begin` claimed the run, and the parent is planning it.
	PLANNING: 'planning',
	// The supervisor took the run over from the parent and is asking for the first offer.
	HANDING_OFF: 'handing off',
} as const

const OPENING = 'opening lane'

// The driver is about to open a lane for `issue` — for every child, not only the first.
function opening_lane(issue: string): string {
	return `${OPENING} ${issue_cite.plain(issue)}`
}

// Best-effort, as every append to this stream is: a stage that could not be written is a board that
// says less, never a run that failed.
async function emit(text: string): Promise<void> {
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.SETUP, text)
}

// The same append for a caller that already holds the repository's common git directory and the moment
// it wants the stage dated — the launcher, whose record and first stage carry one time.
function emit_in(repository: string, text: string, at: Date): void {
	try {
		const target = run_event_stream.target_of(repository)

		run_event_stream.append(target, run_event_stream.EVENT_KIND.SETUP, text, at.toISOString())
	} catch (error) {
		error_text.trace_swallowed('run_event_setup.emit_in', error)
	}
}

const run_event_setup = { STAGE, emit, emit_in, opening_lane }

export { run_event_setup }
