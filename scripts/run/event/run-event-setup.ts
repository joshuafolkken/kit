import { issue_cite } from '#scripts/issue/issue-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// The stages a run passes between `josh backlogrun` and its first child, each written to the stream as
// one `setup` event by the step that enters it. **The text is the stage's own words**: `run:board` draws
// it as written, so the message a person reads and the `💓` beside it come from one event and cannot
// disagree. Only the stages of a lane's launch — opening it, installing into it, dispatching its child —
// name an issue, which is how a reader tells them from the stages before them.

const STAGE = {
	// `josh backlogrun` started the parent session, which is reading its procedure.
	STARTING: 'starting session',
	// `run:carry --begin` claimed the run, and the parent is planning it.
	PLANNING: 'planning',
	// The supervisor took the run over from the parent and is asking for the first offer.
	HANDING_OFF: 'handing off',
	// The driver answered something only a session can act on — an untriaged child, an epic left to a
	// person — and the supervisor is waking one. The next hand-off replaces it.
	JUDGING: 'waiting on judgment',
	// The supervisor started that session, which is now acting on the driver's answer. It is detached, so
	// its end is the supervisor's next hand-off, which replaces this.
	SESSION: 'judgment session running',
} as const

const OPENING = 'opening lane'
const INSTALLING = 'installing dependencies'
const DISPATCHING = 'dispatching'

// The driver is about to open a lane for `issue` — for every child, not only the first.
function opening_lane(issue: string): string {
	return `${OPENING} ${issue_cite.plain(issue)}`
}

// The lane's work tree exists and its dependencies are about to be installed into it.
function installing(issue: string): string {
	return `${INSTALLING} ${issue_cite.plain(issue)}`
}

// The lane is ready and its child is about to be dispatched; the child's own `child-launch` follows.
function dispatching(issue: string): string {
	return `${DISPATCHING} ${issue_cite.plain(issue)}`
}

// Best-effort, as every append to this stream is: a stage that could not be written is a board that
// says less, never a run that failed.
async function emit(text: string): Promise<void> {
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.SETUP, text)
}

// The same append to a stream the caller resolves, dated the moment it hands over.
function append_stage(resolve_target: () => string, text: string, at: Date): void {
	try {
		const { SETUP } = run_event_stream.EVENT_KIND

		run_event_stream.append(resolve_target(), SETUP, text, at.toISOString())
	} catch (error) {
		error_text.trace_swallowed('run_event_setup.append_stage', error)
	}
}

// For a caller that already holds the repository's common git directory and the moment it wants the
// stage dated — the launcher, whose record and first stage carry one time.
function emit_in(repository: string, text: string, at: Date): void {
	append_stage(() => run_event_stream.target_of(repository), text, at)
}

// For a caller that already holds the stream's own path — the supervisor, which resolved it once.
function emit_to(target: string, text: string, at: Date): void {
	append_stage(() => target, text, at)
}

const run_event_setup = {
	STAGE,
	dispatching,
	emit,
	emit_in,
	emit_to,
	installing,
	opening_lane,
}

export { run_event_setup }
