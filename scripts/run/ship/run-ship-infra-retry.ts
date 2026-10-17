import { setTimeout as delay } from 'node:timers/promises'
import type { ShipSection } from './run-ship'
import type { Stage } from './run-ship-stage'
import { run_ship_stop_cause } from './run-ship-stop-cause'

// A stage that stopped on the infrastructure is run again in place, a bounded number of times, before
// the ship stops (joshuafolkken/kit#3998). Re-running a stage is what a resumed ship does already, so
// a retry repeats nothing a relaunched lane would not; it only skips the stop, the relaunch and the
// wait in between. Any other stop — a finding, a red check, a conflict — returns at once.

const MAX_INFRA_RETRIES = 2
const RETRY_DELAY_MS = 60_000
const RETRY_CAP = String(MAX_INFRA_RETRIES)

type Attempt = () => Promise<ShipSection>

interface RetryHooks {
	wait: (milliseconds: number) => Promise<void>
	note: (text: string) => void
}

const DEFAULT_HOOKS: RetryHooks = {
	wait: async (milliseconds) => {
		await delay(milliseconds)
	},
	note: (text) => {
		process.stderr.write(`${text}\n`)
	},
}

function is_retryable(stage: Stage, section: ShipSection): boolean {
	if (section.code === 0) return false

	const cause = run_ship_stop_cause.cause_of(stage, section.body, section.conflicts)

	return cause === run_ship_stop_cause.CAUSE.INFRA
}

async function retried(
	stage: Stage,
	attempt: Attempt,
	hooks: RetryHooks = DEFAULT_HOOKS,
	retries_left = MAX_INFRA_RETRIES,
): Promise<ShipSection> {
	const section = await attempt()

	if (retries_left === 0 || !is_retryable(stage, section)) return section

	const ordinal = String(MAX_INFRA_RETRIES - retries_left + 1)

	hooks.note(`josh ship: ${stage} stopped on the infrastructure — retry ${ordinal}/${RETRY_CAP}`)
	await hooks.wait(RETRY_DELAY_MS)

	return await retried(stage, attempt, hooks, retries_left - 1)
}

const run_ship_infra_retry = { MAX_INFRA_RETRIES, RETRY_DELAY_MS, retried }

export type { RetryHooks }
export { run_ship_infra_retry }
