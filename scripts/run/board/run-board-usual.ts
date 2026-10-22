import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_stats } from '#scripts/lane/lane-stage-stats'
import { lane_stats } from '#scripts/lane/lane-stats'
import { run_board_phase, type Phase } from './run-board-phase'

// How long each phase usually takes: the lane ledger's median of the stage the phase is
// (`lane-stage-stats.ts`), so a running child that has stood at its phase far longer stands out
// (joshuafolkken/kit#3769). A phase is a `josh ship` stage under the names `run-board-phase.ts` gives
// them, and `implement` is the ledger's derived one. A phase no stage records — `investigate`, `plan`,
// `failed` — has no usual time, and is never drawn as long.
//
// **The median is the recent one** (joshuafolkken/kit#4319): only the last `PERIOD_DAYS` of the
// ledger count, so a faster season long past never pulls the estimate down; a stage with nothing that
// recent falls back to the whole ledger's median.

type UsualTimes = ReadonlyMap<Phase, number>

const IMPLEMENT_PHASE: Phase = 'implement'
const PERIOD_DAYS = 3

// Each phase's ledger stage, from the stage-to-phase names a row's phase is drawn with. The ledger's
// `implement` runs from the dispatch, so it also holds the investigation and the plan the row draws
// before its `implement` phase: the usual time is the longer, which can only draw a phase as long
// later, never sooner.
const PHASE_STAGES: ReadonlyArray<readonly [string, Phase | undefined]> = [
	[lane_stage_stats.IMPLEMENT, IMPLEMENT_PHASE],
	...Object.entries(run_board_phase.SHIP_PHASES),
]

// Per stage, so a run's first lanes — dispatched, no stage recorded yet — still draw every phase.
function medians_of(
	entries: ReadonlyArray<LedgerEntry>,
	now_ms: number,
): ReadonlyMap<string, number> {
	const recent = lane_stats.in_window(entries, lane_stats.window_of(PERIOD_DAYS, now_ms))

	return new Map([...lane_stage_stats.medians(entries), ...lane_stage_stats.medians(recent)])
}

function usual_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): UsualTimes {
	const medians = medians_of(entries, now_ms)

	return new Map(
		PHASE_STAGES.flatMap(([stage, phase]) => {
			const median = medians.get(stage)

			return phase === undefined || median === undefined ? [] : [[phase, median] as const]
		}),
	)
}

const run_board_usual = { usual_of }

export { run_board_usual }
export type { UsualTimes }
