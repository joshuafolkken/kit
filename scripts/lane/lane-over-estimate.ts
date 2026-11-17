import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_implement_rate } from './lane-implement-rate'
import { lane_implement_rate_read } from './lane-implement-rate-read'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_size_stats } from './lane-size-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_why } from './lane-why'

// `josh lane:stats --over`'s estimate column (joshuafolkken/kit#7785): a lane's implement minutes
// beside the minutes its declared size projected before it started — `lane:why`'s projection of the
// size the merge recorded, at the rate measured over the days before the lane's first dispatch. A
// lane whose implement ran past its projection is `over estimate`; one within it ran `to size`; one
// with no recorded size or no measured rate has `no estimate` and is counted on neither side.

const SIDE = { OVER: 'over estimate', TO_SIZE: 'to size', NONE: 'no estimate' } as const
const SIDES = [SIDE.OVER, SIDE.TO_SIZE, SIDE.NONE]
const RATIO_DIGITS = 2
const SEPARATOR = ' · '

type Side = (typeof SIDE)[keyof typeof SIDE]
type SizeEntry = ReturnType<typeof lane_size_stats.merged_sizes>[number]

interface EstimateScale {
	entries: ReadonlyArray<LedgerEntry>
	sizes: ReadonlyArray<SizeEntry>
}

interface LaneEstimate {
	side: Side
	// The projected implement minutes, `undefined` with no estimate.
	projected: number | undefined
	implement_ms: number
}

// The ledger and the sizes merged in `window`, read once per table.
function scale_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): EstimateScale {
	return { entries, sizes: lane_size_stats.merged_sizes(entries, window) }
}

// The minutes `declared` projects at the rate and growth `lane:why` measures, over the days before
// the lane started, so the lane's own implement time and growth never feed its estimate.
function projection_before(
	entries: ReadonlyArray<LedgerEntry>,
	declared: SizeEntry['declared'] | undefined,
	start_ms: number | undefined,
): number | undefined {
	if (start_ms === undefined) return undefined

	const measured = lane_stats.window_of(lane_implement_rate_read.PERIOD_DAYS, start_ms)
	const rate = lane_implement_rate.rate(entries, measured)

	return lane_why.projection_of(declared, rate, lane_size_stats.ratios(entries, measured))
}

function implement_ms(stages: ReadonlyArray<Stage>): number {
	return stages
		.filter((stage) => stage.name === lane_breakdown.IMPLEMENT_STAGE)
		.reduce((total, stage) => total + stage.ms, 0)
}

// The actual-to-projected ratio as the cell prints it; the side reads the same rounded ratio, so a
// cell never prints `×1.00 over estimate`.
function ratio_text(projected: number, ms: number): string {
	return (ms / MS_PER_MINUTE / projected).toFixed(RATIO_DIGITS)
}

// A projection of no minutes (a declared size of no lines) has no ratio, so it is no estimate.
function side_of(projected: number | undefined, ms: number): Side {
	if (projected === undefined || projected <= 0) return SIDE.NONE

	return Number(ratio_text(projected, ms)) > 1 ? SIDE.OVER : SIDE.TO_SIZE
}

// `issue`'s implement time against its projection; `stages` are its `lane:breakdown` stages.
function estimate_of(
	scale: EstimateScale,
	issue: number,
	stages: ReadonlyArray<Stage>,
): LaneEstimate {
	const declared = scale.sizes.find((size) => size.issue === issue)?.declared
	const start_ms = lane_net_time.span_of(scale.entries, issue)?.from_ms
	const projected = projection_before(scale.entries, declared, start_ms)
	const ms = implement_ms(stages)

	return { side: side_of(projected, ms), projected, implement_ms: ms }
}

// The projection, the actual-to-projected ratio and the side, in one cell.
function cell({ side, projected, implement_ms: ms }: LaneEstimate): string {
	if (projected === undefined || side === SIDE.NONE) return side

	return `${projected.toFixed(1)} min ×${ratio_text(projected, ms)} ${side}`
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
