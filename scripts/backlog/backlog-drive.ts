// The body of `josh backlog:drive`: the backlogrun parent's mechanical transitions, run as one resident
// wait instead of a model turn per event (joshuafolkken/kit#2499).
//
// **What it replaces is the parent's turn between two commands.** Measured after #2492 the parent still
// spent about half of its backlogrun requests on nothing but glue: a child's process ends, the model
// wakes, runs `run:merge`, reads a number, runs `lane:launch`, restarts `lane:await`, ends its turn — or,
// headless, polls in the foreground because its turn cannot end. Every one of those steps is a command
// whose answer is already a token, so the loop here only reads tokens and never decides what one means.
//
// **It decides nothing another command answers.** Collecting a child is `run:merge`'s, choosing the next
// issue and the budget are `backlog:offer`'s, opening a lane is `lane:launch`'s, and a child's exit is
// `lane:await`'s re-confirmed process check. What is left is which of them runs next, and when a token is
// one the model has to read — a control verdict, a refused launch, a watch, the end of the run — the
// loop stops and hands that token back rather than acting on it.
//
// **Everything it touches is a port**, the pattern `run-wake-loop.ts` set, so the sequencing is pinned
// without a process, a network or a clock.

// The `run:merge` tokens that need the parent: a hand-off, a person's stop, a tripped guard, a foreign
// owner, an unreadable state. `resumed` is not among them — the same lane is awaited again.
const HANDOFF_TOKENS: ReadonlySet<string> = new Set([
	'over',
	'human-review',
	'stop',
	'environment',
	'busy',
	'retry',
])
const RESUMED_TOKEN = 'resumed'
const RUN_VERDICT = 'run'
const STOP_VERDICT = 'stop'
const WATCH_VERDICT = 'watch'
// The verdicts the loop acts on without the parent. Any other is handed back as it was printed.
const KNOWN_VERDICTS: ReadonlySet<string> = new Set([
	RUN_VERDICT,
	STOP_VERDICT,
	WATCH_VERDICT,
	'wait',
])
const NO_RETRIES = 0

interface OfferRead {
	verdict: string
	issues: ReadonlyArray<string>
	retries: number
	answer?: string | undefined
	reason?: string | undefined
	is_retrospective_done?: boolean
	is_finish?: boolean | undefined
}

interface DriveState {
	// The children this run has in flight — seeded from the open lanes, so a restarted loop resumes them.
	in_flight: Array<string>
	// Every child collected, fed back to `backlog:offer` because GitHub closes a merged issue late.
	exclude: Array<string>
	// When the run last did something, handed to `backlog:budget` as `--active`.
	active: string
	retries: number
	// A `stop` verdict: start nothing more, collect what is in flight, then end.
	is_stopping: boolean
	stop_reason?: string | undefined
	stop_is_finish?: boolean | undefined
}

interface DriveEnd {
	// Why the loop handed control back: `merge`, `launch`, `offer`, `watch`, `stop`, `window` or a verdict.
	reason: string
	// The token the parent reads, where one command printed it.
	token: string | undefined
	issue: string | undefined
	detail?: string
	is_finish?: boolean | undefined
}

interface DrivePorts {
	// Whether a child's process has confirmed-ended — `lane:await`'s re-confirmed check in production.
	is_finished: (issue: string) => boolean
	// `run:merge <N>`'s first stdout token.
	merge: (issue: string) => Promise<string>
	// `backlog:offer`'s answer for the state, or `undefined` when it exited non-zero.
	offer: (state: DriveState) => Promise<OfferRead | undefined>
	launch: (issue: string) => Promise<boolean>
	now: () => Date
}

// An end carries the state reached so far, so the resume line keeps what the pass collected before it.
type PassResult =
	{ kind: 'continue'; state: DriveState } | { kind: 'end'; end: DriveEnd; state: DriveState }

function ended(reason: string, state: DriveState, token?: string, issue?: string): PassResult {
	const detail = reason === STOP_VERDICT ? state.stop_reason : undefined

	return {
		kind: 'end',
		end: {
			reason,
			token,
			issue,
			...(detail !== undefined && { detail }),
			...(reason === STOP_VERDICT && { is_finish: state.stop_is_finish }),
		},
		state,
	}
}

function is_drain(read: OfferRead, state: DriveState): boolean {
	return (
		read.verdict === WATCH_VERDICT && state.in_flight.length === 0 && !read.is_retrospective_done
	)
}

function needs_retrospective(read: OfferRead, state: DriveState): boolean {
	return (
		read.verdict === STOP_VERDICT &&
		read.answer === 'exhausted' &&
		state.in_flight.length === 0 &&
		!read.is_retrospective_done
	)
}

function initial_state(in_flight: ReadonlyArray<string>, active: string): DriveState {
	return {
		in_flight: [...in_flight],
		exclude: [],
		active,
		retries: NO_RETRIES,
		is_stopping: false,
	}
}

// One finished child: collected, excluded, and — unless its cut was resumed in place — out of flight.
async function collect(issue: string, state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const token = await ports.merge(issue)

	// An empty first line is a `run:merge` that failed before printing one: never read as a collection.
	if (token === '') return ended('merge', state, undefined, issue)
	if (HANDOFF_TOKENS.has(token)) return ended('merge', state, token, issue)

	const in_flight =
		token === RESUMED_TOKEN ? state.in_flight : state.in_flight.filter((item) => item !== issue)
	const exclude = state.exclude.includes(issue) ? state.exclude : [...state.exclude, issue]

	return {
		kind: 'continue',
		state: { ...state, in_flight, exclude, active: ports.now().toISOString() },
	}
}

async function collect_finished(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const finished = state.in_flight.filter((item) => ports.is_finished(item))
	let current = state

	for (const issue of finished) {
		const result = await collect(issue, current, ports)

		if (result.kind === 'end') return { ...result, state: current }

		current = result.state
	}

	return { kind: 'continue', state: current }
}

async function launch_all(
	issues: ReadonlyArray<string>,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	const in_flight = [...state.in_flight]

	for (const issue of issues) {
		const is_launched = await ports.launch(issue)

		if (!is_launched) return ended('launch', { ...state, in_flight }, undefined, issue)

		in_flight.push(issue)
	}

	return { kind: 'continue', state: { ...state, in_flight, active: ports.now().toISOString() } }
}

// A watch with nothing in flight is the drain: `run:step` owes the retrospective there, so it is the
// parent's. With children still running the watch is only waiting on them.
function on_verdict(read: OfferRead, state: DriveState): PassResult {
	if (!KNOWN_VERDICTS.has(read.verdict)) return ended(read.verdict, state, read.verdict)
	if (needs_retrospective(read, state)) return ended('retrospective', state, 'retrospective')

	if (read.verdict === STOP_VERDICT) {
		return {
			kind: 'continue',
			state: {
				...state,
				is_stopping: true,
				stop_reason: read.reason,
				stop_is_finish: read.is_finish,
			},
		}
	}

	if (is_drain(read, state)) return ended(WATCH_VERDICT, state, WATCH_VERDICT)

	return { kind: 'continue', state }
}

async function ask_offer(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const read = await ports.offer(state)

	if (read === undefined) return ended('offer', state)

	const next = { ...state, retries: read.retries }

	if (read.verdict === RUN_VERDICT) return await launch_all(read.issues, next, ports)

	return on_verdict(read, next)
}

// One pass: collect every child that ended, then — unless a `stop` has been read — ask what to start.
// `should_offer` is the caller's throttle on the one network read; a collection always asks, because a
// lane just freed.
function is_offering(before: DriveState, after: DriveState, should_offer: boolean): boolean {
	if (after.is_stopping) return false

	return should_offer || after.in_flight.length !== before.in_flight.length
}

// A stopping run with nothing left in flight has ended.
function settle(result: PassResult): PassResult {
	if (result.kind === 'end') return result

	const is_done = result.state.is_stopping && result.state.in_flight.length === 0

	return is_done ? ended(STOP_VERDICT, result.state, STOP_VERDICT) : result
}

async function run_pass(
	state: DriveState,
	should_offer: boolean,
	ports: DrivePorts,
): Promise<PassResult> {
	const collected = await collect_finished(state, ports)

	if (collected.kind === 'end') return collected
	if (!is_offering(state, collected.state, should_offer)) return settle(collected)

	return settle(await ask_offer(collected.state, ports))
}

interface LoopConfig {
	poll_ms: number
	// The floor between two `backlog:offer` asks while nothing was collected — the same one-minute
	// cadence the wake supervisor polls the backlog on, so an idle stretch is not a network hammer.
	offer_ms: number
	// How long one invocation may wait before returning `window`, or `undefined` for no bound. A headless
	// parent's foreground call is capped by its shell's timeout, so it passes one under that cap.
	window_ms: number | undefined
}

interface LoopPorts extends DrivePorts {
	sleep: (milliseconds: number) => Promise<void>
	finish: (end: DriveEnd) => Promise<void>
	// Called after every pass, ended ones included, so the caller can keep the resume line current.
	on_state: (state: DriveState) => void
}

interface LoopRun {
	state: DriveState
	started_ms: number
	offered_ms: number
}

const WINDOW_END: DriveEnd = { reason: 'window', token: undefined, issue: undefined }

function is_window_spent(run: LoopRun, config: LoopConfig, now_ms: number): boolean {
	if (config.window_ms === undefined) return false

	return now_ms - run.started_ms >= config.window_ms
}

type LoopStep = { kind: 'end'; end: DriveEnd } | { kind: 'next'; run: LoopRun }

// One pass of the loop: the offer is due on the first pass and then no oftener than `offer_ms`, bar the
// passes that collected a child. A `next` carries the run to sleep on and pass again.
async function loop_step(run: LoopRun, config: LoopConfig, ports: LoopPorts): Promise<LoopStep> {
	const now_ms = ports.now().getTime()
	const is_due = now_ms - run.offered_ms >= config.offer_ms
	const result = await run_pass(run.state, is_due, ports)

	ports.on_state(result.state)

	if (result.kind === 'end') return result

	const next = { ...run, state: result.state, offered_ms: is_due ? now_ms : run.offered_ms }

	return is_window_spent(next, config, ports.now().getTime())
		? { kind: 'end', end: WINDOW_END }
		: { kind: 'next', run: next }
}

// Pass, sleep, repeat — until a pass hands a token back or the window is spent.
async function run_loop(
	state: DriveState,
	config: LoopConfig,
	ports: LoopPorts,
): Promise<DriveEnd> {
	const first: LoopRun = { state, started_ms: ports.now().getTime(), offered_ms: -Infinity }
	let step = await loop_step(first, config, ports)

	while (step.kind === 'next') {
		await ports.sleep(config.poll_ms)
		step = await loop_step(step.run, config, ports)
	}

	if (step.end.reason === STOP_VERDICT) await ports.finish(step.end)

	return step.end
}

const backlog_drive = { HANDOFF_TOKENS, collect, initial_state, on_verdict, run_loop, run_pass }

export type { DriveEnd, DrivePorts, DriveState, LoopConfig, LoopPorts, OfferRead, PassResult }
export { backlog_drive }
