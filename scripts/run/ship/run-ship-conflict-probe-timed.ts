import { run_ship_conflict_probe } from './run-ship-conflict-probe'
import { run_ship_lap } from './run-ship-lap'
import { run_ship_stage } from './run-ship-stage'
import type { StepResult } from './run-ship-sync'

// `josh ship --detach`'s pre-detach conflict probe, timed as the foreground sync's lap, so the ledger
// holds it whatever the caller does with the output (joshuafolkken/kit#7737).

async function probe(issue: string): Promise<StepResult | undefined> {
	return await run_ship_lap.within(
		issue,
		run_ship_stage.STAGE.SYNC,
		async () =>
			await run_ship_lap.timed(
				run_ship_lap.STEP.CONFLICT_PROBE,
				async () => await run_ship_conflict_probe.probe(),
			),
	)
}

const run_ship_conflict_probe_timed = { probe }

export { run_ship_conflict_probe_timed }
