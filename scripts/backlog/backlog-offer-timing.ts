import type { DriveState, LoopConfig, LoopPorts } from './backlog-drive'
import { backlog_drive_memory } from './backlog-drive-memory'

interface OfferTiming {
	idle_until_ms?: number | undefined
	not_before_ms?: number | undefined
}

interface LoopRun {
	state: DriveState
	started_ms: number
	offered_ms: number
	// The last instant the `auto-ok` listing was checked, or an ask read it.
	checked_ms: number
}

function first_run(state: DriveState, now_ms: number): LoopRun {
	return { state, started_ms: now_ms, offered_ms: -Infinity, checked_ms: -Infinity }
}

function is_window_spent(run: LoopRun, config: LoopConfig, now_ms: number): boolean {
	if (config.window_ms === undefined) return false

	return now_ms - run.started_ms >= config.window_ms
}

// A deadline is due once: one the last ask already reached falls back to the interval.
function due_ms(deadline: number | undefined, offered_ms: number, interval_ms: number): number {
	return deadline !== undefined && deadline > offered_ms ? deadline : offered_ms + interval_ms
}

function deadline_of(state: DriveState): number | undefined {
	if (state.is_stopping || state.not_before_ms === undefined) return undefined

	return Math.min(state.not_before_ms, state.idle_until_ms ?? Infinity)
}

// The short interval only while no lane runs and a named issue is left to dispatch: a running batch and
// a watch with nothing named keep `offer_ms` (joshuafolkken/kit#6788).
function interval_of(state: DriveState, config: LoopConfig, is_named_left: boolean): number {
	return is_named_left && state.in_flight.length === 0 ? config.idle_offer_ms : config.offer_ms
}

type DuePorts = Pick<
	LoopPorts,
	'added_since' | 'raised_since' | 'memory_held' | 'named_left' | 'free_lanes' | 'listing_changed'
>

async function interval_for(run: LoopRun, config: LoopConfig, ports: DuePorts): Promise<number> {
	const is_named_left = run.state.in_flight.length === 0 && (await ports.named_left())

	return interval_of(run.state, config, is_named_left)
}

function is_check_due(run: LoopRun, config: LoopConfig, now_ms: number): boolean {
	return now_ms >= run.checked_ms + config.check_ms
}

// The `auto-ok` listing, checked by its ETag at `check_ms` while a seat is free: a 304 spends no REST
// core, so a new issue is asked about without waiting out the interval (joshuafolkken/kit#7227).
async function is_listing_changed(
	run: LoopRun,
	config: LoopConfig,
	ports: DuePorts,
	now_ms: number,
): Promise<boolean> {
	if (!is_check_due(run, config, now_ms) || (await ports.free_lanes()) === 0) return false

	return await ports.listing_changed()
}

async function is_signalled(run: LoopRun, ports: DuePorts): Promise<boolean> {
	return (
		(await backlog_drive_memory.is_cleared(run.state, ports)) ||
		(await ports.added_since(run.offered_ms)) ||
		(await ports.raised_since(run.offered_ms))
	)
}

// Whether the pass asks now: a dated wait at its deadline, other waits at the interval — or at once
// when a memory hold cleared, `run:add` handed the run an issue, `lane:limit` raised the limit since
// the last ask, or the `auto-ok` listing changed. The interval stays the floor for the changes the
// listing's ETag does not show: a blocker closed, a later page, an epic.
async function is_due(
	run: LoopRun,
	config: LoopConfig,
	ports: DuePorts,
	now_ms: number,
): Promise<boolean> {
	const interval_ms = await interval_for(run, config, ports)
	if (now_ms >= due_ms(deadline_of(run.state), run.offered_ms, interval_ms)) return true

	return (await is_signalled(run, ports)) || (await is_listing_changed(run, config, ports, now_ms))
}

interface PassStep {
	state: DriveState
	is_asked: boolean
}

// The run after a pass: an ask, or a check that came due, restarts the check interval.
function advanced(run: LoopRun, step: PassStep, config: LoopConfig, now_ms: number): LoopRun {
	const { state, is_asked } = step
	const is_checked = is_asked || is_check_due(run, config, now_ms)
	const offered_ms = is_asked ? now_ms : run.offered_ms

	return { ...run, state, offered_ms, checked_ms: is_checked ? now_ms : run.checked_ms }
}

function sleep_ms(deadline: number | undefined, milliseconds: number, now_ms: number): number {
	const remaining = (deadline ?? Infinity) - now_ms

	// A passed deadline waits the full interval; sleep(0) would spin until a seat frees.
	return remaining > 0 ? Math.min(milliseconds, remaining) : milliseconds
}

function sleeper(
	deadline: () => number | undefined,
	ports: Pick<LoopPorts, 'now' | 'sleep'>,
): (milliseconds: number) => Promise<void> {
	return async function wait(milliseconds: number): Promise<void> {
		const duration = sleep_ms(deadline(), milliseconds, ports.now().getTime())

		await ports.sleep(duration)
	}
}

const backlog_offer_timing = {
	advanced,
	deadline_of,
	due_ms,
	first_run,
	interval_of,
	is_due,
	is_window_spent,
	sleep_ms,
	sleeper,
}

export type { LoopRun, OfferTiming }
export { backlog_offer_timing }
