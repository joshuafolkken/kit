// How often a waiting reservation re-reads the ledger: short enough that a freed place is taken up
// promptly, long enough that the wait itself burns no measurable CPU.
const POLL_INTERVAL_MS = 50
// The longest a reservation waits before it is admitted at minimum width regardless — a heavy step must
// make progress even if the budget never clears, so a leaked or wedged sibling cannot stall the machine
// for good. Two minutes is well past a unit suite's worst measured time under six-way load. A claim a
// swap stall holds is the exception (`core_admission.is_swap_held`).
const WAIT_CAP_MS = 120_000
// How long the load may go without easing before a held reservation is admitted at minimum width ahead
// of the cap (`busy_average.is_unrelieved`): ten of the busy average's windows.
const EASE_WINDOW_MS = 30_000

interface Cadence {
	poll_interval_ms: number
	wait_cap_ms: number
	ease_window_ms: number
}

// The clock and cadence a wait runs on, resolved apart from the ledger fields so `reserve` stays under
// the complexity limit — each default is a branch.
interface TimingConfig extends Cadence {
	now: () => number
	sleep: (ms: number) => Promise<void>
}

async function default_sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})
}

function resolve_cadence(options: Partial<Cadence>): Cadence {
	return {
		poll_interval_ms: options.poll_interval_ms ?? POLL_INTERVAL_MS,
		wait_cap_ms: options.wait_cap_ms ?? WAIT_CAP_MS,
		ease_window_ms: options.ease_window_ms ?? EASE_WINDOW_MS,
	}
}

function resolve_timing(options: Partial<TimingConfig>): TimingConfig {
	return {
		now: options.now ?? Date.now,
		sleep: options.sleep ?? default_sleep,
		...resolve_cadence(options),
	}
}

const core_budget_timing = { WAIT_CAP_MS, resolve_timing }

export type { TimingConfig }
export { core_budget_timing }
