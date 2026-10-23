// How often a waiting reservation re-reads the ledger: short enough that a freed place is taken up
// promptly, long enough that the wait itself burns no measurable CPU.
const POLL_INTERVAL_MS = 50
// The longest a reservation waits before it is admitted at minimum width regardless — a heavy step must
// make progress even if the budget never clears, so a leaked or wedged sibling cannot stall the machine
// for good. Two minutes is well past a unit suite's worst measured time under six-way load. A claim a
// swap stall holds is the exception (`core_admission.is_swap_held`).
const WAIT_CAP_MS = 120_000

// The clock and cadence a wait runs on, resolved apart from the ledger fields so `reserve` stays under
// the complexity limit — each default is a branch.
interface TimingConfig {
	now: () => number
	sleep: (ms: number) => Promise<void>
	poll_interval_ms: number
	wait_cap_ms: number
}

async function default_sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})
}

function resolve_timing(options: Partial<TimingConfig>): TimingConfig {
	return {
		now: options.now ?? Date.now,
		sleep: options.sleep ?? default_sleep,
		poll_interval_ms: options.poll_interval_ms ?? POLL_INTERVAL_MS,
		wait_cap_ms: options.wait_cap_ms ?? WAIT_CAP_MS,
	}
}

const core_budget_timing = { WAIT_CAP_MS, resolve_timing }

export type { TimingConfig }
export { core_budget_timing }
