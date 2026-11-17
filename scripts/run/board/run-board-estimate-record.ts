import type { EstimateRecord } from '#scripts/lane/lane-ledger-schema-estimate'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_board_estimate } from './run-board-estimate'
import type { BoardPlan } from './run-board-layout'
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

// What the estimate is read through: the local read, the run's plan and the time the board says is
// left.
interface EstimateReads {
	read_local: () => Promise<LocalRead | undefined>
	read_plan: (scope: LocalRead['scope']) => Promise<BoardPlan | undefined>
	left_of: (local: LocalRead, plan: BoardPlan | undefined, now_ms: number) => number | undefined
}

function left_of(
	local: LocalRead,
	plan: BoardPlan | undefined,
	now_ms: number,
): number | undefined {
	const state = { ...run_board_tick.FRESH_STATE, plan }
	const layout = run_board_tick.layout_for(state, local, now_ms)

	return run_board_estimate.left_ms({ now_ms, ...local, layout })
}

const LIVE_READS: EstimateReads = {
	read_local: async () => await run_board_read.read_local(),
	read_plan: run_board_plan_shared.read,
	left_of,
}

// An ended run is not estimated, as the board's header does not (`run-board-estimate.ts`), so a
// dispatch after a run ended never attaches a row to it.
async function read_estimate(
	now_ms: number,
	reads: EstimateReads = LIVE_READS,
): Promise<Estimate | undefined> {
	const local = await reads.read_local()

	if (local === undefined || local.ended_ms !== undefined) return undefined

	const plan = await reads.read_plan(local.scope)

	return { run: run_of(local), left_ms: reads.left_of(local, plan, now_ms) }
}

const LIVE_PORTS: EstimatePorts = {
	read: async (now_ms) => await read_estimate(now_ms),
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

const run_board_estimate_record = { left_of, read_estimate, record }

export type { Estimate, EstimatePorts, EstimateReads }
export { run_board_estimate_record }
