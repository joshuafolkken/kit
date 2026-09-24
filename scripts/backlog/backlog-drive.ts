import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import type { ChildOutcome } from '#scripts/run/run-merge'
import { run_merge_cli } from '#scripts/run/run-merge-cli'
import { backlog_budget, type BacklogAnswer, type BudgetVerdict } from './backlog-budget'

// `josh backlog:drive` — the `backlogrun` parent loop run without an AI session (joshuafolkken/kit#2508).
// The loop — `backlog:offer` → `lane:launch` → `lane:await` → `run:merge` → the next offer — already had
// every answer computed by a command; a session only relayed them, one turn at a time. This drives the
// loop itself until a branch that needs a judgement, then stops with that branch as one line.
//
// **Every answer comes from the generator it came from before**: the offer from `backlog_offer.answer_of`
// and `backlog_budget.decide`, the launch from `lane:launch`'s chain, the wait from `lane_await`, the
// merge event from `run:merge`'s handlers. This file is the order they are asked in and nothing else, so
// the ports below are the only seam — the CLI wires production, a test wires a fixture.

const SETTLED_KINDS: ReadonlySet<string> = new Set([
	run_event_stream.EVENT_KIND.MERGE,
	run_event_stream.EVENT_KIND.PARK,
	run_event_stream.EVENT_KIND.OUTAGE,
])
const TRACKED_KINDS: ReadonlySet<string> = new Set([
	...SETTLED_KINDS,
	run_event_stream.EVENT_KIND.CHILD_LAUNCH,
])
const ISSUE_TEXT = /^#(\d+)\b/u
const MERGE_ATTEMPTS = 3
const WATCH_POLL_MS = backlog_budget.IDLE_POLL_MINUTES * backlog_budget.MS_PER_MINUTE

// The judgement branches, keyed by the token `run:merge` answered with. Each is a stop the loop cannot
// decide past: a hand-off (`over`), a child's own ending, a tripped guard, a down environment, or a
// carry record this process does not own.
const TOKEN_STOPS: Readonly<Record<string, string>> = {
	[run_merge_cli.OVER_TOKEN]: 'over',
	[run_merge_cli.HUMAN_REVIEW_TOKEN]: 'human-review',
	[run_merge_cli.STOP_TOKEN]: 'stop',
	[run_merge_cli.ENVIRONMENT_TOKEN]: 'environment',
	[run_merge_cli.BUSY_TOKEN]: 'busy',
}

// The outcomes that answer with the next offer yet still need a person: a child that parked itself and
// a child that failed (a cut no successor adopted is handled as failed by `run:merge`).
const OUTCOME_STOPS: Partial<Record<ChildOutcome, string>> = {
	cut: 'failed',
	failed: 'failed',
	parked: 'park',
}

interface DriveOffer {
	verdict: BudgetVerdict
	reason: string
	answer: BacklogAnswer
	issues: ReadonlyArray<string>
	retries: number
	// Whether a `stop` is the run finishing rather than stopping — `backlog_budget.is_finish`.
	is_finish: boolean
}

interface OfferAsk {
	running: number
	retries: number
	excludes: ReadonlyArray<string>
	active_at_ms: number
}

interface ChildResult {
	outcome: ChildOutcome
	token: string
}

interface DrivePorts {
	offer: (ask: OfferAsk) => Promise<DriveOffer>
	launch: (issue: string, stash: string | undefined) => Promise<boolean>
	// Whether the lane's child process is alive now — asked once at start, so a lane whose child ended
	// while nothing was driving is merged at once rather than awaited for a process that never appears.
	is_running: (issue: string) => boolean
	await_any: (issues: ReadonlyArray<string>) => Promise<string>
	merge: (issue: string) => Promise<ChildResult>
	// Writes the drain marker once per drain; `true` only when this call wrote it.
	mark_drain: () => Promise<boolean>
	finish: (offer: DriveOffer) => Promise<void>
	sleep: (milliseconds: number) => Promise<void>
	now: () => number
}

interface DriveStop {
	verdict: string
	issue: string | undefined
	detail: string | undefined
}

interface DriveState {
	running: Array<string>
	excludes: Array<string>
	retries: number
	active_at_ms: number
	// The `josh latest` stash message, carried to the first launch only and then cleared.
	stash: string | undefined
}

type Settle =
	| { kind: 'next'; outcome: ChildOutcome }
	| { kind: 'again' }
	| { kind: 'retry' }
	| { kind: 'stop'; stop: DriveStop }

function stop_of(verdict: string, issue?: string, detail?: string): DriveStop {
	return { verdict, issue, detail }
}

function issue_of(event: RunEvent): string | undefined {
	return ISSUE_TEXT.exec(event.text)?.[1]
}

// Each child's newest launch-or-settle event: a child launched again after an outage reads as running.
function last_kinds(events: ReadonlyArray<RunEvent>): ReadonlyMap<string, string> {
	const kinds = new Map<string, string>()

	for (const event of events) {
		const issue = issue_of(event)

		if (issue !== undefined && TRACKED_KINDS.has(event.kind)) kinds.set(issue, event.kind)
	}

	return kinds
}

// **Restart is read, never remembered**: the running children are the open lanes whose newest event is
// not a settle, and the merged ones are excluded from the offer. A driver killed and started again
// therefore neither re-merges a settled child nor launches onto a lane that is still open.
function restore(
	lanes: ReadonlyArray<string>,
	events: ReadonlyArray<RunEvent>,
	now_ms: number,
): DriveState {
	const kinds = last_kinds(events)
	const running = lanes.filter((lane) => !SETTLED_KINDS.has(kinds.get(lane) ?? ''))
	const excludes = [...kinds]
		.filter(([, kind]) => kind === run_event_stream.EVENT_KIND.MERGE)
		.map(([issue]) => issue)

	// The resume moment is the run's newest activity, as a resumed parent states it with `--active`.
	return { running, excludes, retries: 0, active_at_ms: now_ms, stash: undefined }
}

function settle_of(issue: string, result: ChildResult): Settle {
	if (result.token === run_merge_cli.RESUMED_TOKEN) return { kind: 'again' }
	if (result.token === run_merge_cli.RETRY_TOKEN) return { kind: 'retry' }

	const token_stop = TOKEN_STOPS[result.token]

	if (token_stop !== undefined) return { kind: 'stop', stop: stop_of(token_stop, issue) }

	const outcome_stop = OUTCOME_STOPS[result.outcome]

	if (outcome_stop !== undefined) return { kind: 'stop', stop: stop_of(outcome_stop, issue) }

	return { kind: 'next', outcome: result.outcome }
}

// One pass's result: the state the next pass starts from, and the stop when the pass reached one.
interface Pass {
	state: DriveState
	stop: DriveStop | undefined
}

function going(state: DriveState): Pass {
	return { state, stop: undefined }
}

function stopped(state: DriveState, stop: DriveStop): Pass {
	return { state, stop }
}

// A child that answered anything but `resumed` has left the running set; a merged one is excluded from
// the next offer as the parent's `--exclude` did.
function apply_settle(state: DriveState, issue: string, settled: Settle): Pass {
	if (settled.kind === 'again') return going(state)

	const running = state.running.filter((child) => child !== issue)

	if (settled.kind === 'stop') return stopped({ ...state, running }, settled.stop)

	const is_merged = settled.kind === 'next' && settled.outcome === 'merged'
	const excludes = is_merged ? [...state.excludes, issue] : state.excludes

	return going({ ...state, running, excludes })
}

// `retry` means the child's state could not be read; it is read again, a bounded number of times.
async function settle(ports: DrivePorts, state: DriveState, issue: string): Promise<Pass> {
	for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
		const settled = settle_of(issue, await ports.merge(issue))

		if (settled.kind !== 'retry') return apply_settle(state, issue, settled)
	}

	return stopped(state, stop_of('unresolved', issue))
}

// The children whose process ended while nothing was driving: merged now, before the first offer.
async function settle_ended(ports: DrivePorts, state: DriveState): Promise<Pass> {
	const ended = state.running.filter((child) => !ports.is_running(child))
	let pass = going(state)

	for (const issue of ended) {
		pass = await settle(ports, pass.state, issue)

		if (pass.stop !== undefined) return pass
	}

	return pass
}

async function launch_all(
	ports: DrivePorts,
	state: DriveState,
	issues: ReadonlyArray<string>,
): Promise<Pass> {
	let current = state

	for (const issue of issues) {
		const is_launched = await ports.launch(issue, current.stash)

		if (!is_launched) return stopped(current, stop_of('launch-failed', issue))

		current = { ...current, stash: undefined, running: [...current.running, issue] }
	}

	return going(current)
}

// A watch with children in flight waits for one to return; with none, the first ask of a drain stops
// for the end-of-run retrospective (`run:step` decides whether one is owed), and any later ask sleeps.
async function watch(ports: DrivePorts, state: DriveState, offer: DriveOffer): Promise<Pass> {
	if (state.running.length > 0) {
		return await settle(ports, state, await ports.await_any(state.running))
	}

	if (offer.answer === 'exhausted' && (await ports.mark_drain())) {
		return stopped(state, stop_of('drain'))
	}

	await ports.sleep(WATCH_POLL_MS)

	return going(state)
}

async function finish(ports: DrivePorts, state: DriveState, offer: DriveOffer): Promise<Pass> {
	await ports.finish(offer)

	return stopped(state, stop_of(offer.is_finish ? 'done' : 'stopped', undefined, offer.reason))
}

function ask_of(state: DriveState): OfferAsk {
	const { running, retries, excludes, active_at_ms } = state

	return { running: running.length, retries, excludes, active_at_ms }
}

// What the offer itself changes: the retry count, and the last moment the run had work.
function offered(state: DriveState, offer: DriveOffer, now_ms: number): DriveState {
	const active_at_ms = offer.answer === 'exhausted' ? state.active_at_ms : now_ms

	return { ...state, retries: offer.retries, active_at_ms }
}

// One pass of the loop head: ask the offer, then act on its verdict.
async function step(ports: DrivePorts, state: DriveState): Promise<Pass> {
	const offer = await ports.offer(ask_of(state))
	const next = offered(state, offer, ports.now())

	if (offer.verdict === backlog_budget.RUN_VERDICT) {
		return await launch_all(ports, next, offer.issues)
	}

	if (offer.verdict === backlog_budget.WATCH_VERDICT) return await watch(ports, next, offer)

	return await finish(ports, next, offer)
}

async function run_loop(ports: DrivePorts, state: DriveState): Promise<DriveStop> {
	let pass = await settle_ended(ports, state)

	while (pass.stop === undefined) pass = await step(ports, pass.state)

	return pass.stop
}

// A port that throws — `lane_await` does for a child that never appeared — is a stop with its message,
// never a crash: the caller always gets its one line.
async function drive(ports: DrivePorts, state: DriveState): Promise<DriveStop> {
	try {
		return await run_loop(ports, state)
	} catch (error: unknown) {
		return stop_of('error', undefined, error instanceof Error ? error.message : String(error))
	}
}

// The one line a caller branches on: the verdict, then the issue and the detail where there are any.
function line_of(stop: DriveStop): string {
	const issue = stop.issue === undefined ? [] : [`#${stop.issue}`]
	const detail = stop.detail === undefined ? [] : [stop.detail]

	return [stop.verdict, ...issue, ...detail].join(' ')
}

const backlog_drive = { MERGE_ATTEMPTS, WATCH_POLL_MS, drive, line_of, restore, settle_of }

export type { ChildResult, DriveOffer, DrivePorts, DriveState, DriveStop, OfferAsk }
export { backlog_drive }
