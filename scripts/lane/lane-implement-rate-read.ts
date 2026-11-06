import { lane_implement_rate, type ImplementRate } from './lane-implement-rate'
import { lane_ledger } from './lane-ledger'
import type { MeasureContext } from './lane-sampler'
import { lane_size_stats, type SizeRatios } from './lane-size-stats'
import { lane_stats } from './lane-stats'

// The recent implement rate, independent of the planning and split decisions that consume it.
const PERIOD_DAYS = 3

type ReadContext = Pick<MeasureContext, 'ledger_path' | 'events_path'>

interface SizeMeasurements {
	implement_rate: ImplementRate | undefined
	growth: SizeRatios
}

async function read_ledger(
	context: ReadContext,
): Promise<ReturnType<typeof lane_ledger.read_entries>> {
	const path = context.ledger_path ?? (await lane_ledger.target())

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

async function implement_rate(
	context: ReadContext = {},
	now_ms: number = Date.now(),
): Promise<ImplementRate | undefined> {
	const window = lane_stats.window_of(PERIOD_DAYS, now_ms)

	return lane_implement_rate.rate(await read_ledger(context), window)
}

async function measurements(
	context: ReadContext = {},
	now_ms: number = Date.now(),
): Promise<SizeMeasurements> {
	const entries = await read_ledger(context)
	const window = lane_stats.window_of(PERIOD_DAYS, now_ms)

	return {
		implement_rate: lane_implement_rate.rate(entries, window),
		growth: lane_size_stats.ratios(entries, window),
	}
}

const lane_implement_rate_read = { PERIOD_DAYS, implement_rate, measurements, read_ledger }

export { lane_implement_rate_read }
export type { SizeMeasurements }
