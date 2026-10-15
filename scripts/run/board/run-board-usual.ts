import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_stats } from '#scripts/lane/lane-stage-stats'
import { run_board_phase, type Phase } from './run-board-phase'

// How long each phase usually takes: the lane ledger's median of the stage the phase is
// (`lane-stage-stats.ts`), so a running child that has stood at its phase far longer stands out
// (joshuafolkken/kit#3769). A phase is a `josh ship` stage under the names `run-board-phase.ts` gives
// them, and `implement` is the ledger's derived one. A phase no stage records — `investigate`, `plan`,
// `failed` — has no usual time, and is never drawn as long.

type UsualTimes = ReadonlyMap<Phase, number>

const IMPLEMENT_PHASE: Phase = 'implement'

// Each phase's ledger stage, from the stage-to-phase names a row's phase is drawn with. The ledger's
// `implement` runs from the dispatch, so it also holds the investigation and the plan the row draws
// before its `implement` phase: the usual time is the longer, which can only draw a phase as long
// later, never sooner.
const PHASE_STAGES: ReadonlyArray<readonly [string, Phase | undefined]> = [
	[lane_stage_stats.IMPLEMENT, IMPLEMENT_PHASE],
	...Object.entries(run_board_phase.SHIP_PHASES),
]

function usual_of(entries: ReadonlyArray<LedgerEntry>): UsualTimes {
	const medians = lane_stage_stats.medians(entries)

	return new Map(
		PHASE_STAGES.flatMap(([stage, phase]) => {
			const median = medians.get(stage)

			return phase === undefined || median === undefined ? [] : [[phase, median] as const]
		}),
	)
}

// The repository's whole ledger, read where the board reads its stream; an absent one has no usual time.
function read(repository: string): UsualTimes {
	return usual_of(lane_ledger.read_entries(lane_ledger.target_of(repository)))
}

const run_board_usual = { read, usual_of }

export { run_board_usual }
export type { UsualTimes }
