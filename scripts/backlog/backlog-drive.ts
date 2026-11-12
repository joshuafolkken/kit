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

import { poll } from '#scripts/lib/poll'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_token } from '#scripts/run/merge/run-merge-token'
import { backlog_drive_adopt } from './backlog-drive-adopt'
import { backlog_drive_hold, type HeldWaiting } from './backlog-drive-hold'
import { backlog_drive_idle } from './backlog-drive-idle'
import { backlog_drive_judge } from './backlog-drive-judge'
import { backlog_drive_launch_pass, type DriveLaunch } from './backlog-drive-launch-pass'
import { backlog_drive_memory } from './backlog-drive-memory'
import { backlog_drive_park_triage as park_triage } from './backlog-drive-park-triage'
import { backlog_drive_paused } from './backlog-drive-paused'
import { backlog_drive_retrospective } from './backlog-drive-retrospective'
import { backlog_drive_state } from './backlog-drive-state'
import { backlog_drive_token_handling } from './backlog-drive-token-handling'
import { backlog_hold_codes } from './backlog-hold-codes'
import { backlog_offer_timing, type LoopRun, type OfferTiming } from './backlog-offer-timing'
import { backlog_yield_cap, type YieldCapPorts } from './backlog-yield-cap'

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
const JUDGE_REASON = 'judge'
const { launch_all } = backlog_drive_launch_pass
const { is_drain_owed } = backlog_drive_retrospective
const { initial_state, merge_stopped } = backlog_drive_state

interface OfferRead extends HeldWaiting, OfferTiming {
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
	// Whether `backlog:next` held an untriaged candidate back from this `run`: the lanes open first and
	// the pass then hands `triage` back, so the judgment session runs beside them.
	is_judgment_owed?: boolean | undefined
	is_finish?: boolean | undefined
}

interface DriveState extends OfferTiming {
	// The children this run has in flight — seeded from the open lanes, so a restarted loop resumes them.
	in_flight: Array<string>
	// Every child merged, fed back to `backlog:offer` because GitHub closes a merged issue late. A parked
	// child is left out: its labels classify it, so one a person released is offered again — except one
	// the yield cap parked (`backlog-yield-cap.ts`), which stays out of the pool's offer whether or not
	// its park went through; the auto-retry re-offers it by name (`backlog-drive-stalled-retry.ts`).
	exclude: Array<string>
	// The issues whose measurement declaration had no sample yet: kept out of the offer, not merged.
	waiting?: Array<string> | undefined
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
	// A collected park still owes the parent triage after an interrupted collection resumes.
	is_triage_owed?: boolean | undefined
	// The triage session the supervisor launched beside the driver (`backlog-drive-park-triage.ts`).
	triage_pid?: number | undefined
	triage_start?: string | undefined
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

type Collected = Pick<MergeResult, 'token' | 'outcome' | 'is_offer' | 'is_parked'>

// The yield cap's ports (`backlog-yield-cap.ts`): the issue's yields, and its park.
interface DrivePorts extends YieldCapPorts {
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
	// or `measured` / `unsampled`, the issue closed by its declaration or waiting for its sample, with
	// no lane taken, or `split`, an issue over the size bar its split-only unit split.
	launch: (issue: string) => Promise<DriveLaunch>
	// Parks a launch the pass hands back with `run:stalled` — `backlog_drive_record.record_ports` in production.
	stall: (issue: string, outcome: DriveLaunch) => Promise<void>
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
	// Whether a Claude usage limit that stopped a child has yet to reset — `run_merge_usage_limit.is_held`
	// in production (joshuafolkken/kit#4745).
	usage_limited: () => Promise<boolean>
	// Why an offered pass started nothing (`backlog-drive-hold.ts`). Production records it in the lane
	// ledger only while a lane is free. `undefined` is the run's stop, which owes no lane a child.
	hold: (reason: string | undefined, waiting?: ReadonlyArray<number>) => Promise<void>
	// A watch with nothing in flight — the one idle notification (`backlog-drive-idle.ts`), deduplicated
	// per episode by the port itself.
	idle: (state: DriveState) => Promise<void>
	// A holding offer with nothing in flight — the paused-lane notice (`backlog-drive-paused.ts`), which
	// reads the lane records itself and is deduplicated per pause episode by the port.
	paused: () => Promise<void>
	// A `stop` drain owing the retrospective: the unit run to its end, `true` once the run record's
	// retrospective is marked (`backlog_drive_retrospective_unit.run` in production).
	retrospective: () => Promise<boolean>
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

// A merged child is excluded because `backlog:next` may still read it OPEN, and a withdrawn one because
// `lane:withdraw` leaves it OPEN for the next run, not this one (joshuafolkken/kit#4365). Any other is
// classified by its labels, so excluding it would hide a child a person released for the rest of the
// process.
function excluded(issue: string, outcome: Collected['outcome'], state: DriveState): Array<string> {
	if (!EXCLUDED_OUTCOMES.has(outcome) || state.exclude.includes(issue)) return state.exclude

	return [...state.exclude, issue]
}

function was_parked(collected: Collected): boolean {
	return collected.outcome === 'parked' || collected.is_parked === true
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

	const is_triage_owed = state.is_triage_owed === true || was_parked(collected)

	return { ...state, in_flight, exclude, active, is_triage_owed }
}

// One finished child: handed back on an immediate token, otherwise collected.
async function collect(issue: string, state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const collected = await ports.merge(issue)
	const { token, is_offer } = collected

	// An empty first line is a `run:merge` that failed before printing one: never read as a collection.
	// An offer's `retry` is `backlog:next`'s transport answer, left to the next `backlog:offer`.
	if (token === '') return ended('merge', state, undefined, issue)
	if (!is_offer && IMMEDIATE_TOKENS.has(token)) return ended('merge', state, token, issue)

	const active = ports.now().toISOString()
	const next = await backlog_yield_cap.capped(
		issue,
		collected.outcome,
		collected_state(issue, collected, state, active),
		ports,
	)

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
// parent's. With children still running the watch is only waiting on them. A `stop` drain's
// retrospective is the driver's own unit (`backlog_drive_retrospective.ran`).
function on_verdict(read: OfferRead, state: DriveState): PassResult {
	if (!KNOWN_VERDICTS.has(read.verdict)) return ended(read.verdict, state, read.verdict)

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

async function usage_held(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	await ports.hold(backlog_hold_codes.USAGE_LIMIT_REASON)

	return { kind: 'continue', state }
}

// An offer answered `run`: launched while the machine has memory to spare and no usage limit is in
// force, held until both hold otherwise. A usage-limited pass polls on as a held one does.
async function run_offered(
	issues: ReadonlyArray<string>,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	if (await ports.usage_limited()) return await usage_held(state, ports)

	if (await ports.memory_held()) return await backlog_drive_memory.held(state, ports)

	return await launch_all(issues, state, ports)
}

// A `run` that held an untriaged candidate back, or that follows a collected park, ends the pass with
// `triage` once its lanes are open — a pass the launch itself ended keeps that end, and the next offer
// owes the judgment again.
async function run_then_judge(
	read: OfferRead,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	const result = await run_offered(read.issues, state, ports)

	return park_triage.triaged(result, read.is_judgment_owed === true || park_triage.is_owed(state))
}

// An answer other than `run`, read by the judge, the verdict, the retrospective, the idle and the pause.
async function answered(read: OfferRead, next: DriveState, ports: DrivePorts): Promise<PassResult> {
	if (await backlog_drive_judge.is_owed(read, ports)) return ended(JUDGE_REASON, next, JUDGE_REASON)

	const verdict = await backlog_drive_retrospective.ran(on_verdict(read, next), read, ports)
	const idle = await backlog_drive_idle.noticed(verdict, read, ports)
	const result = await backlog_drive_paused.noticed(idle, read, ports)

	return await backlog_drive_hold.held(result, read, ports)
}

// Every offer answers the memory hold afresh: one that is not `run` leaves nothing held for memory.
async function ask_offer(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	const read = await ports.offer(state)

	if (read === undefined) return park_triage.hand_back(state) ?? ended('offer', state)

	const next = {
		...state,
		retries: read.retries,
		is_memory_held: false,
		not_before_ms: read.not_before_ms,
		idle_until_ms: read.idle_until_ms,
	}

	if (read.verdict === RUN_VERDICT) return await run_then_judge(read, next, ports)

	return park_triage.hand_back(next) ?? (await answered(read, next, ports))
}

// One pass: collect every child that ended, then — unless a `stop` has been read — ask what to start.
// `should_offer` throttles the network read; a collection, or a park owing triage, asks immediately.
function is_offering(before: DriveState, after: DriveState, should_offer: boolean): boolean {
	const is_collected = after.in_flight.length !== before.in_flight.length

	return !after.is_stopping && (should_offer || is_collected || park_triage.is_owed(after))
}

// No free lane hands any owed triage back unasked.
async function offered(state: DriveState, ports: DrivePorts): Promise<PassResult> {
	if ((await ports.free_lanes()) === 0) {
		return park_triage.hand_back(state) ?? { kind: 'continue', state }
	}

	return await ask_offer(state, ports)
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
	const held = await backlog_drive_adopt.held(park_triage.settled(state), should_offer, ports)
	const collected = await collect_finished(held, ports)

	if (collected.kind === 'end') return collected
	if (!is_offering(held, collected.state, should_offer)) return settle(collected)

	return settle(await offered(collected.state, ports))
}

interface LoopConfig {
	poll_ms: number
	// The floor between two `backlog:offer` asks while nothing was collected, running or idle alike —
	// `backlog_budget.OFFER_INTERVAL_MS`. A `run:add` since the last ask skips it.
	offer_ms: number
	// The floor instead while no lane runs and a named issue is left to dispatch —
	// `backlog_budget.IDLE_OFFER_INTERVAL_MS`.
	idle_offer_ms: number
	// How often the `auto-ok` listing is checked between asks — `LISTING_CHECK_INTERVAL_MS`.
	check_ms: number
	// How long one invocation may wait before returning `window`, or `undefined` for no bound. A headless
	// parent's foreground call is capped by its shell's timeout, so it passes one under that cap.
	window_ms: number | undefined
}

interface LoopPorts extends DrivePorts {
	sleep: (milliseconds: number) => Promise<void>
	// Called first in every tick with the lanes in flight: the snapshot the tick's answers share
	// (`backlog_drive_tick.tick_share` in production, joshuafolkken/kit#7016).
	begin_tick: (in_flight: ReadonlyArray<string>) => Promise<void>
	// Whether `run:add` handed the run an issue at or after the given instant —
	// `backlog_arrival_added.is_added_since` in production.
	added_since: (since_ms: number) => Promise<boolean>
	// Whether `lane:limit` raised the limit at or after the given instant — `is_raised_since` in production.
	raised_since: (since_ms: number) => Promise<boolean>
	// Whether an issue the run names is still left to dispatch — the run record's remaining in production.
	named_left: () => Promise<boolean>
	// Whether the `auto-ok` listing changed since the last read — `backlog_drive_listing.is_changed`.
	listing_changed: () => Promise<boolean>
	finish: (end: DriveEnd) => Promise<void>
	// Called after every pass, ended ones included, so the caller can keep the resume line current.
	on_state: (state: DriveState) => void
}

const WINDOW_END: DriveEnd = { reason: 'window', token: undefined, issue: undefined }

type LoopStep = { kind: 'end'; end: DriveEnd } | { kind: 'next'; run: LoopRun }

// When a pass asks is `backlog_offer_timing.is_due`'s; a collected child can still ask immediately.
async function loop_step(run: LoopRun, config: LoopConfig, ports: LoopPorts): Promise<LoopStep> {
	await ports.begin_tick(run.state.in_flight)
	const now_ms = ports.now().getTime()
	const is_due = await backlog_offer_timing.is_due(run, config, ports, now_ms)
	const result = await run_pass(run.state, is_due, ports)

	ports.on_state(result.state)

	if (result.kind === 'end') return result

	const step = { state: result.state, is_asked: is_due }
	const next = backlog_offer_timing.advanced(run, step, config, now_ms)

	return backlog_offer_timing.is_window_spent(next, config, ports.now().getTime())
		? { kind: 'end', end: WINDOW_END }
		: { kind: 'next', run: next }
}

// Pass, sleep, repeat — until a pass hands a token back or the window is spent.
async function run_loop(
	state: DriveState,
	config: LoopConfig,
	ports: LoopPorts,
): Promise<DriveEnd> {
	const progress = { run: backlog_offer_timing.first_run(state, ports.now().getTime()) }
	const end = await poll.wait_for(
		async () => {
			const step = await loop_step(progress.run, config, ports)
			if (step.kind === 'next') Object.assign(progress, { run: step.run })

			return step.kind === 'end' ? step.end : undefined
		},
		{
			interval_ms: config.poll_ms,
			sleeper: backlog_offer_timing.sleeper(
				() => backlog_offer_timing.deadline_of(progress.run.state),
				ports,
			),
		},
	)

	if (end.reason === STOP_VERDICT) await ports.finish(end)

	return end
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
