// The body of `josh backlog:drive`: the backlogrun parent's mechanical transitions, run as one resident
// wait instead of a model turn per event.
//
// **What it replaces is the parent's turn between two commands.** Without it the parent spends about
// half of its backlogrun requests on nothing but glue: a child's process ends, the model wakes, runs
// `run:merge`, reads a number, runs `lane:launch`, restarts `lane:await`, ends its turn — or, headless,
// polls in the foreground because its turn cannot end. Every one of those steps is a command
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

import { issue_cite } from '#scripts/issue/issue-cite'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_token } from '#scripts/run/merge/run-merge-token'
import { backlog_drive_adopt } from './backlog-drive-adopt'
import { backlog_drive_hold, type HeldWaiting } from './backlog-drive-hold'
import { backlog_drive_idle } from './backlog-drive-idle'
import { backlog_drive_judge } from './backlog-drive-judge'
import { backlog_drive_launch_pass, type DriveLaunch } from './backlog-drive-launch-pass'
import { backlog_drive_memory } from './backlog-drive-memory'
import { backlog_drive_paused } from './backlog-drive-paused'
import { backlog_drive_token_handling } from './backlog-drive-token-handling'

const { MERGE_TOKEN } = run_merge_token
const { HANDOFF_TOKENS, IMMEDIATE_TOKENS, TOKEN_HANDLING } = backlog_drive_token_handling
const RUN_VERDICT = 'run'
const STOP_VERDICT = 'stop'
// The outcomes that keep a child out of the rest of this run's offers.
const EXCLUDED_OUTCOMES: ReadonlySet<string> = new Set(['merged', 'withdrawn'])
const WATCH_VERDICT = 'watch'
// The verdicts the loop acts on without the parent. Any other is handed back as it was printed.
const KNOWN_VERDICTS: ReadonlySet<string> = new Set([
	RUN_VERDICT,
	STOP_VERDICT,
	WATCH_VERDICT,
	'wait',
])
const NO_RETRIES = 0
const EXHAUSTED_ANSWER = 'exhausted'
const JUDGE_REASON = 'judge'
const { launch_all } = backlog_drive_launch_pass

interface OfferRead extends HeldWaiting {
	verdict: string
	issues: ReadonlyArray<string>
	retries: number
	answer?: string | undefined
	// Why a `blocked` answer started nothing — `solo`, or `backlog-wait-cause.ts`'s with its `waiting`.
	cause?: string | undefined
	reason?: string | undefined
	// Whether a drain here owes the retrospective: the opt-in switch is on and it has not run yet. Absent
	// reads as not owed, so a drain with the switch off keeps the idle watch.
	is_retrospective_owed?: boolean
	is_finish?: boolean | undefined
}

interface DriveState {
	// The children this run has in flight — seeded from the open lanes, so a restarted loop resumes them.
	in_flight: Array<string>
	// Every child merged, fed back to `backlog:offer` because GitHub closes a merged issue late. A parked
	// child is left out: its labels classify it, so one a person released is offered again.
	exclude: Array<string>
	// When the run last did something, handed to `backlog:budget` as `--active`.
	active: string
	retries: number
	// A `stop` verdict: start nothing more, collect what is in flight, then end.
	is_stopping: boolean
	stop_reason?: string | undefined
	stop_is_finish?: boolean | undefined
	// The child whose merge answered `stop`, carried on the resume line: no offer re-derives that stop.
	stopped_by?: string | undefined
	// The last offer answered `run` on a machine with no memory to spare (`backlog-drive-memory.ts`).
	is_memory_held?: boolean | undefined
}

interface DriveEnd {
	// Why the loop handed control back: `merge`, `launch`, `offer`, `judge`, `watch`, `stop`, `window`
	// or a verdict.
	reason: string
	// The token the parent reads, where one command printed it.
	token: string | undefined
	issue: string | undefined
	detail?: string
	is_finish?: boolean | undefined
}

type Collected = Pick<MergeResult, 'token' | 'outcome' | 'is_offer'>

interface DrivePorts {
	// Whether a child's process has confirmed-ended — `lane:await`'s re-confirmed check in production.
	is_finished: (issue: string) => boolean
	// `run:merge <N>`'s first stdout token and the outcome it handled the child as.
	merge: (issue: string) => Promise<Collected>
	// The lanes on a child this run launched and never settled that the loop does not hold — one the
	// parent dispatched itself with `lane:launch` (`backlog_drive_adopt.adoptable` in production).
	adoptable: (in_flight: ReadonlyArray<string>) => Promise<ReadonlyArray<string>>
	// `backlog:offer`'s answer for the state, or `undefined` when it exited non-zero.
	offer: (state: DriveState) => Promise<OfferRead | undefined>
	// Where `lane:launch`'s chain ended — `launched`, `unopened` (no lane taken) or `failed` (one taken) —
	// or `measured`, the issue closed by its declaration with no lane taken.
	launch: (issue: string) => Promise<DriveLaunch>
	// The lanes free right now — `backlog_ready.drive_free_lane_count` in production, the limit less the
	// open lanes.
	free_lanes: () => Promise<number>
	// The places left under the limit, port seats aside — `backlog_ready.drive_limit_room` in production.
	limit_room: () => Promise<number>
	// Whether the issue already holds a kept lane (one a child was dispatched into) — it is reused, and
	// seated ahead of a fresh launch inside the limit room (`backlog-drive-seats.ts`).
	has_lane: (issue: string) => Promise<boolean>
	// How many open issues lacking `auto-ok` still owe a judgement — `auto_ok_judge_read.owed` in
	// production, `0` when the read failed.
	judgement_owed: () => Promise<number>
	// Whether the machine has no memory for one more lane — `backlog_drive_memory.gauge()` in production,
	// which carries its hysteresis between calls.
	memory_held: () => Promise<boolean>
	// Why an offered pass started nothing (`backlog-drive-hold.ts`). Production records it in the lane
	// ledger only while a lane is free. `undefined` is the run's stop, which owes no lane a child.
	hold: (reason: string | undefined, waiting?: ReadonlyArray<number>) => Promise<void>
	// A watch with nothing in flight — the one idle notification (`backlog-drive-idle.ts`), deduplicated
	// per episode by the port itself.
	idle: (state: DriveState) => Promise<void>
	// A holding offer with nothing in flight — the paused-lane notice (`backlog-drive-paused.ts`), which
	// reads the lane records itself and is deduplicated per pause episode by the port.
	paused: () => Promise<void>
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

// A drain owing the retrospective, read under a `watch` or a `stop` verdict. Only an empty backlog
// drains: `backlog:offer` marks the drain on `exhausted` alone, so a watch over a parked or unreadable
// backlog has no retrospective for `run:step` to fire and stays the driver's.
function is_drain_owed(read: OfferRead, state: DriveState, verdict: string): boolean {
	return (
		read.verdict === verdict &&
		read.answer === EXHAUSTED_ANSWER &&
		state.in_flight.length === 0 &&
		read.is_retrospective_owed === true
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

// The stop a merge reached: kept as the first stop's reason when an offer already stopped the run.
function merge_stopped(issue: string, state: DriveState): DriveState {
	if (state.is_stopping) return state

	return {
		...state,
		is_stopping: true,
		stop_reason: `run:merge ${issue_cite.plain(issue)} answered stop`,
		stopped_by: issue,
	}
}

// A merged child is excluded because `backlog:next` may still read it OPEN, and a withdrawn one because
// `lane:withdraw` leaves it OPEN for the next run, not this one (joshuafolkken/kit#4365). Any other is
// classified by its labels, so excluding it would hide a child a person released for the rest of the
// process.
function excluded(issue: string, outcome: Collected['outcome'], state: DriveState): Array<string> {
	if (!EXCLUDED_OUTCOMES.has(outcome) || state.exclude.includes(issue)) return state.exclude

	return [...state.exclude, issue]
}

// The child collected, and — unless its cut was resumed in place — out of flight.
function collected_state(
	issue: string,
	collected: Collected,
	state: DriveState,
	active: string,
): DriveState {
	const in_flight =
		collected.token === MERGE_TOKEN.RESUMED
			? state.in_flight
			: state.in_flight.filter((item) => item !== issue)
	const exclude = excluded(issue, collected.outcome, state)

	return { ...state, in_flight, exclude, active }
}

// One finished child: handed back on an immediate token, otherwise collected.
async function collect(issue: string, state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const collected = await ports.merge(issue)
	const { token, is_offer } = collected

	// An empty first line is a `run:merge` that failed before printing one: never read as a collection.
	// An offer's `retry` is `backlog:next`'s transport answer, left to the next `backlog:offer`.
	if (token === '') return ended('merge', state, undefined, issue)
	if (!is_offer && IMMEDIATE_TOKENS.has(token)) return ended('merge', state, token, issue)

	const next = collected_state(issue, collected, state, ports.now().toISOString())

	return {
		kind: 'continue',
		state: run_merge_token.is_control_stop(collected) ? merge_stopped(issue, next) : next,
	}
}

async function collect_finished(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const finished = state.in_flight.filter((item) => ports.is_finished(item))
	let current = state

	for (const issue of finished) {
		// eslint-disable-next-line no-await-in-loop -- each collect starts from the state the previous one returned
		const result = await collect(issue, current, ports)

		if (result.kind === 'end') return { ...result, state: current }

		current = result.state
	}

	await backlog_drive_hold.stopped(state, current, ports)

	return { kind: 'continue', state: current }
}

// A watch with nothing in flight is the drain: `run:step` owes the retrospective there, so it is the
// parent's. With children still running the watch is only waiting on them.
function on_verdict(read: OfferRead, state: DriveState): PassResult {
	if (!KNOWN_VERDICTS.has(read.verdict)) return ended(read.verdict, state, read.verdict)

	if (is_drain_owed(read, state, STOP_VERDICT)) {
		return ended('retrospective', state, 'retrospective')
	}

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

	if (is_drain_owed(read, state, WATCH_VERDICT)) return ended(WATCH_VERDICT, state, WATCH_VERDICT)

	return { kind: 'continue', state }
}

// An offer answered `run`: launched while the machine has memory to spare, held until it does otherwise.
async function run_offered(
	issues: ReadonlyArray<string>,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	if (await ports.memory_held()) return await backlog_drive_memory.held(state, ports)

	return await launch_all(issues, state, ports)
}

// Every offer answers the memory hold afresh: one that is not `run` leaves nothing held for memory.
async function ask_offer(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const read = await ports.offer(state)

	if (read === undefined) return ended('offer', state)

	const next = { ...state, retries: read.retries, is_memory_held: false }

	if (read.verdict === RUN_VERDICT) return await run_offered(read.issues, next, ports)
	if (await backlog_drive_judge.is_owed(read, ports)) return ended(JUDGE_REASON, next, JUDGE_REASON)

	const idle = await backlog_drive_idle.noticed(on_verdict(read, next), read, ports)
	const result = await backlog_drive_paused.noticed(idle, read, ports)

	return await backlog_drive_hold.held(result, read, ports)
}

// One pass: collect every child that ended, then — unless a `stop` has been read — ask what to start.
// `should_offer` is the caller's throttle on the one network read; a collection always asks, because a
// lane just freed.
function is_offering(before: DriveState, after: DriveState, should_offer: boolean): boolean {
	return !after.is_stopping && (should_offer || after.in_flight.length !== before.in_flight.length)
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
	const held = await backlog_drive_adopt.held(state, should_offer, ports)
	const collected = await collect_finished(held, ports)

	if (collected.kind === 'end') return collected
	if (!is_offering(held, collected.state, should_offer)) return settle(collected)

	return settle(await ask_offer(collected.state, ports))
}

interface LoopConfig {
	poll_ms: number
	// The floor between two `backlog:offer` asks while nothing was collected, running or idle alike —
	// `backlog_budget.OFFER_INTERVAL_MS`, the interval the wake supervisor polls on too.
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
// passes that collected a child and the one that finds a memory hold cleared. A `next` carries the run
// to sleep on and pass again.
async function loop_step(run: LoopRun, config: LoopConfig, ports: LoopPorts): Promise<LoopStep> {
	const now_ms = ports.now().getTime()
	const is_due =
		now_ms - run.offered_ms >= config.offer_ms ||
		(await backlog_drive_memory.is_cleared(run.state, ports))
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
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await ports.sleep(config.poll_ms)
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		step = await loop_step(step.run, config, ports)
	}

	if (step.end.reason === STOP_VERDICT) await ports.finish(step.end)

	return step.end
}

const backlog_drive = {
	HANDOFF_TOKENS,
	TOKEN_HANDLING,
	initial_state,
	merge_stopped,
	run_loop,
	run_pass,
}

export type { DriveEnd, DrivePorts, DriveState, LoopConfig, LoopPorts, OfferRead, PassResult }
export { backlog_drive }
