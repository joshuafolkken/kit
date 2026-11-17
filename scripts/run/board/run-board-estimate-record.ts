import type { EstimateRecord } from '#scripts/lane/lane-ledger-schema-estimate'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_board_estimate } from './run-board-estimate'
import { run_board_plan_shared } from './run-board-plan-shared'
import { run_board_read, type LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// The run's finish estimate, written to the lane ledger as a lane child is dispatched
// (joshuafolkken/kit#7775), so `lane:stats` can measure how far it was off. It is read the way
// `run:board --chat` reads it — the local read, the run's plan and a fresh board state — and never by a
// redraw, which would write one row a second. A dispatch outside a run, or a moment nothing is
// estimated (no measured lane, no child running or waiting), writes nothing. Best-effort: a failed
// read writes nothing and never stops the dispatch.

interface Estimate {
	run: string
	left_ms: number | undefined
}

interface EstimatePorts {
	read: (now_ms: number) => Promise<Estimate | undefined>
	write: (record: EstimateRecord) => Promise<void>
}

// The run is named by its start, which no other run shares.
function run_of(local: LocalRead): string {
	return new Date(local.started_ms).toISOString()
}

async function read_estimate(now_ms: number): Promise<Estimate | undefined> {
	const local = await run_board_read.read_local()

	if (local === undefined) return undefined

	const plan = await run_board_plan_shared.read(local.scope)
	const state = { ...run_board_tick.FRESH_STATE, plan }
	const layout = run_board_tick.layout_for(state, local, now_ms)
	const left_ms = run_board_estimate.left_ms({ now_ms, ...local, layout })

	return { run: run_of(local), left_ms }
}

const LIVE_PORTS: EstimatePorts = {
	read: read_estimate,
	write: lane_ledger_write.record_estimate,
}

async function record(issue: number, ports: EstimatePorts = LIVE_PORTS): Promise<void> {
	const now_ms = Date.now()

	try {
		const estimate = await ports.read(now_ms)

		if (estimate?.left_ms === undefined) return

		const finish_at = new Date(now_ms + estimate.left_ms).toISOString()

		await ports.write({ issue, run: estimate.run, finish_at })
	} catch {
		// The next dispatch records again.
	}
}

const run_board_estimate_record = { record }

export type { Estimate, EstimatePorts }
export { run_board_estimate_record }
