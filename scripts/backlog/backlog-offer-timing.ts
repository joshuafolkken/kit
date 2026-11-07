import type { DriveState, LoopConfig, LoopPorts } from './backlog-drive'

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

const backlog_offer_timing = { deadline_of, due_ms, is_window_spent, sleep_ms, sleeper }

export type { LoopRun, OfferTiming }
export { backlog_offer_timing }
