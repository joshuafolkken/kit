import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_implement_rate, type ImplementRate } from './lane-implement-rate'
import { lane_implement_rate_read } from './lane-implement-rate-read'
import type { LedgerEntry } from './lane-ledger'
import { lane_size_stats, type SizeRatios } from './lane-size-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_why } from './lane-why'

// `josh lane:stats --over`'s estimate column (joshuafolkken/kit#7785): a lane's implement minutes
// beside the minutes its declared size projected before it started — `lane:why`'s projection of the
// size the merge recorded, at the rate measured over the days before the period ended. A lane whose
// implement ran past its projection is `over estimate`; one within it ran `to size`; one with no
// recorded size or no measured rate has `no estimate` and is counted on neither side.

const SIDE = { OVER: 'over estimate', TO_SIZE: 'to size', NONE: 'no estimate' } as const
const SIDES = [SIDE.OVER, SIDE.TO_SIZE, SIDE.NONE]
const RATIO_DIGITS = 2
const SEPARATOR = ' · '

type Side = (typeof SIDE)[keyof typeof SIDE]
type SizeEntry = ReturnType<typeof lane_size_stats.merged_sizes>[number]

interface EstimateScale {
	sizes: ReadonlyArray<SizeEntry>
	rate: ImplementRate | undefined
	growth: SizeRatios
}

interface LaneEstimate {
	side: Side
	// The projected implement minutes, `undefined` with no estimate.
	projected: number | undefined
	implement_ms: number
}

// The merged sizes of `window` and the rate and growth `lane:why` measures, ending at the period's end.
function scale_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): EstimateScale {
	const measured = lane_stats.window_of(lane_implement_rate_read.PERIOD_DAYS, window.until_ms)

	return {
		sizes: lane_size_stats.merged_sizes(entries, window),
		rate: lane_implement_rate.rate(entries, measured),
		growth: lane_size_stats.ratios(entries, measured),
	}
}

function implement_ms(stages: ReadonlyArray<Stage>): number {
	return stages
		.filter((stage) => stage.name === lane_breakdown.IMPLEMENT_STAGE)
		.reduce((total, stage) => total + stage.ms, 0)
}

function side_of(projected: number | undefined, ms: number): Side {
	if (projected === undefined) return SIDE.NONE

	return ms / MS_PER_MINUTE > projected ? SIDE.OVER : SIDE.TO_SIZE
}

// `issue`'s implement time against its projection; `stages` are its `lane:breakdown` stages.
function estimate_of(
	scale: EstimateScale,
	issue: number,
	stages: ReadonlyArray<Stage>,
): LaneEstimate {
	const declared = scale.sizes.find((size) => size.issue === issue)?.declared
	const projected = lane_why.projection_of(declared, scale.rate, scale.growth)
	const ms = implement_ms(stages)

	return { side: side_of(projected, ms), projected, implement_ms: ms }
}

// The projection, the actual-to-projected ratio and the side, in one cell.
function cell({ side, projected, implement_ms: ms }: LaneEstimate): string {
	if (projected === undefined) return side

	const ratio = (ms / MS_PER_MINUTE / projected).toFixed(RATIO_DIGITS)

	return `${projected.toFixed(1)} min ×${ratio} ${side}`
}

// `estimate: over estimate 1 · to size 2 · no estimate 0`.
function counts_line(estimates: ReadonlyArray<LaneEstimate>): string {
	const counts = SIDES.map(
		(side) => `${side} ${String(estimates.filter((estimate) => estimate.side === side).length)}`,
	)

	return `estimate: ${counts.join(SEPARATOR)}`
}

const lane_over_estimate = { SIDE, cell, counts_line, estimate_of, scale_of }

export { lane_over_estimate }
export type { EstimateScale, LaneEstimate }
