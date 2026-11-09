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

type DuePorts = Pick<LoopPorts, 'added_since' | 'memory_held' | 'named_left'>

async function interval_for(run: LoopRun, config: LoopConfig, ports: DuePorts): Promise<number> {
	const is_named_left = run.state.in_flight.length === 0 && (await ports.named_left())

	return interval_of(run.state, config, is_named_left)
}

// Whether the pass asks now: a dated wait at its deadline, other waits at the interval — or at once
// when a memory hold cleared or `run:add` handed the run an issue since the last ask.
async function is_due(
	run: LoopRun,
	config: LoopConfig,
	ports: DuePorts,
	now_ms: number,
): Promise<boolean> {
	const interval_ms = await interval_for(run, config, ports)
	if (now_ms >= due_ms(deadline_of(run.state), run.offered_ms, interval_ms)) return true

	return (
		(await backlog_drive_memory.is_cleared(run.state, ports)) ||
		(await ports.added_since(run.offered_ms))
	)
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
	deadline_of,
	due_ms,
	interval_of,
	is_due,
	is_window_spent,
	sleep_ms,
	sleeper,
}

export type { LoopRun, OfferTiming }
export { backlog_offer_timing }
