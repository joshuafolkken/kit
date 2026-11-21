import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import type { LaneSpan } from '#scripts/lane/lane-net-time'
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

function recent_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): Array<LedgerEntry> {
	return lane_stats.in_window(entries, lane_stats.window_of(PERIOD_DAYS, now_ms))
}

// Per stage, so a run's first lanes — dispatched, no stage recorded yet — still draw every phase.
function medians_of(
	entries: ReadonlyArray<LedgerEntry>,
	now_ms: number,
	gaps: ReadonlyArray<LaneSpan>,
): ReadonlyMap<string, number> {
	return new Map([
		...lane_stage_stats.medians(entries, gaps),
		...lane_stage_stats.medians(recent_of(entries, now_ms), gaps),
	])
}

// Whether the window alone measures every phase's stage, so none falls back to the whole ledger and
// `entries` need cover only the window (joshuafolkken/kit#7932). The host's stops only shorten a span,
// never drop one, so they cannot change which stages are measured.
function covers(entries: ReadonlyArray<LedgerEntry>, now_ms: number): boolean {
	const recent = lane_stage_stats.medians(recent_of(entries, now_ms))

	return PHASE_STAGES.every(([stage, phase]) => phase === undefined || recent.has(stage))
}

function compute_usual(
	entries: ReadonlyArray<LedgerEntry>,
	now_ms: number,
	gaps: ReadonlyArray<LaneSpan>,
): UsualTimes {
	const medians = medians_of(entries, now_ms, gaps)

	return new Map(
		PHASE_STAGES.flatMap(([stage, phase]) => {
			const median = medians.get(stage)

			return phase === undefined || median === undefined ? [] : [[phase, median] as const]
		}),
	)
}

// The last ledger's usual times: `lane_ledger.read_entries` hands back the same array while the file
// is unchanged, so a board round over it aggregates nothing again (joshuafolkken/kit#7012). The recent
// window then trails `now_ms` only until the next append — the sampler's, within a minute. A new host
// stop in `gaps` aggregates again too.
const usual_memo = new WeakMap<
	ReadonlyArray<LedgerEntry>,
	{ gaps_key: string; usual: UsualTimes }
>()

function gaps_key_of(gaps: ReadonlyArray<LaneSpan>): string {
	return gaps.map((gap) => `${String(gap.from_ms)}-${String(gap.to_ms)}`).join(',')
}

// Each phase's usual time, the wall-clock implementation net of `gaps`, the host's stops; a recorded
// stage is monotonic time that already pauses through them (joshuafolkken/kit#7905).
function usual_of(
	entries: ReadonlyArray<LedgerEntry>,
	now_ms: number,
	gaps: ReadonlyArray<LaneSpan> = [],
): UsualTimes {
	const gaps_key = gaps_key_of(gaps)
	const known = usual_memo.get(entries)

	if (known?.gaps_key === gaps_key) return known.usual

	const usual = compute_usual(entries, now_ms, gaps)

	usual_memo.set(entries, { gaps_key, usual })

	return usual
}

const run_board_usual = { PERIOD_DAYS, covers, usual_of }

export { run_board_usual }
export type { UsualTimes }
