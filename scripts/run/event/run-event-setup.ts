import { issue_cite } from '#scripts/issue/issue-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// The stages a run passes between `josh backlogrun` and its first child, and those of a later hand-back
// to a session, each written to the stream as one `setup` event by the step that enters it. **The text
// is the stage's own words**: `run:board` draws it as written, so the message a person reads and the
// `💓` beside it come from one event and cannot disagree. Only the stages of a lane's launch — opening
// it, installing into it, dispatching its child — name an issue, which is how a reader tells them from
// the stages before them.

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
	// The driver's launch of a lane returned without a child: no lane was free to open, or a step after
	// the open failed. Written through `no_child`, naming its issue, so it ends that lane's stage alone
	// while the pass's other launches run on (joshuafolkken/kit#5519).
	NO_CHILD: 'no child launched',
} as const

const OPENING = 'opening lane'
const INSTALLING = 'installing dependencies'
const DISPATCHING = 'dispatching'
// The stages of one lane's launch, in the order a lane passes them.
const LANE_STAGE = { OPENING, INSTALLING, DISPATCHING } as const

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

// The launch for `issue` returned without a child.
function no_child(issue: string): string {
	return `${STAGE.NO_CHILD} ${issue_cite.plain(issue)}`
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

// A session's start until its first lane opening (joshuafolkken/kit#5519); `end_ms` is unset while
// none has opened.
interface FirstLaneSpan {
	from_ms: number
	end_ms: number | undefined
}

function is_stage(event: RunEvent, prefix: string): boolean {
	return event.kind === run_event_stream.EVENT_KIND.SETUP && event.text.startsWith(prefix)
}

// Only an opening before the session's next start is its own: a restarted session times itself anew.
function first_lane_span(start: RunEvent, later: ReadonlyArray<RunEvent>): FirstLaneSpan {
	const next_start = later.findIndex((event) => is_stage(event, STAGE.STARTING))
	const session = next_start === -1 ? later : later.slice(0, next_start)
	const opening = session.find((event) => is_stage(event, OPENING))

	return {
		from_ms: Date.parse(start.at),
		end_ms: opening === undefined ? undefined : Date.parse(opening.at),
	}
}

// Every session the stream started, timed to its first lane — read by `run:board` and `lane:stats`.
function first_lane_spans(events: ReadonlyArray<RunEvent>): Array<FirstLaneSpan> {
	return events.flatMap((event, index) =>
		is_stage(event, STAGE.STARTING) ? [first_lane_span(event, events.slice(index + 1))] : [],
	)
}

// The newest session's time to its first lane, `undefined` until a lane opened.
function first_lane_ms(events: ReadonlyArray<RunEvent>): number | undefined {
	const span = first_lane_spans(events).at(-1)

	return span?.end_ms === undefined ? undefined : span.end_ms - span.from_ms
}

const run_event_setup = {
	LANE_STAGE,
	STAGE,
	dispatching,
	emit,
	emit_in,
	emit_to,
	first_lane_ms,
	first_lane_spans,
	installing,
	no_child,
	opening_lane,
}

export { run_event_setup }
