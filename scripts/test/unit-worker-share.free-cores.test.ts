import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unit_worker_share, type FreeCapacity, type UnitClaim } from './unit-worker-share'

// joshuafolkken/kit#3945: the share divided the machine by the unit runs in flight and never asked
// what the machine had free, so load from outside the core budget's ledger — 22 of 38 heavy samples
// had vitest as their heaviest process — ran on top of a full share.

// The machine the surrounding measurements were taken on: Apple M3 Pro, 11 logical cores.
const MEASURED_CORES = 11
const PAIRED_RUNS = 2
// What one of two runs takes on the measured machine: ⌊11 ÷ 2⌋.
const PAIRED_SHARE = 5
const SCARCE_FREE = 3
const AMPLE_FREE = 9
// Room for three workers and part of a fourth, which is not a worker.
const SCARCE_MEMORY_WORKERS = 3.5
const AMPLE_MEMORY_WORKERS = MEASURED_CORES
const UNREAD_MEMORY = { memory_workers: undefined }

describe('unit_worker_share.cap_to_free — the smaller of the share and the free cores', () => {
	it('takes the free cores when they are fewer than the share', () => {
		expect(unit_worker_share.cap_to_free(PAIRED_SHARE, SCARCE_FREE, MEASURED_CORES)).toBe(
			SCARCE_FREE,
		)
	})

	it('keeps the share when the free cores cover it', () => {
		expect(unit_worker_share.cap_to_free(PAIRED_SHARE, AMPLE_FREE, MEASURED_CORES)).toBe(
			PAIRED_SHARE,
		)
	})

	// A CI runner or a CPU quota narrower than the host reads no free cores at all.
	it('keeps the share as it was where the machine could not be read', () => {
		expect(unit_worker_share.cap_to_free(PAIRED_SHARE, undefined, MEASURED_CORES)).toBe(
			PAIRED_SHARE,
		)
		expect(unit_worker_share.cap_to_free(undefined, undefined, MEASURED_CORES)).toBeUndefined()
	})

	// A solo run leaves its pool to vitest, whose pool is at most the core count.
	it('bounds a solo run only when the free cores are fewer than the machine', () => {
		expect(unit_worker_share.cap_to_free(undefined, MEASURED_CORES, MEASURED_CORES)).toBeUndefined()
		expect(unit_worker_share.cap_to_free(undefined, SCARCE_FREE, MEASURED_CORES)).toBe(SCARCE_FREE)
	})

	// The budget subtracts whole cores from the count, so a heavily loaded machine reads zero or less.
	it('never hands out fewer than one worker', () => {
		expect(unit_worker_share.cap_to_free(PAIRED_SHARE, 0, MEASURED_CORES)).toBe(
			unit_worker_share.MIN_WORKERS,
		)
		expect(unit_worker_share.cap_to_free(PAIRED_SHARE, -1, MEASURED_CORES)).toBe(
			unit_worker_share.MIN_WORKERS,
		)
	})
})

describe('unit_worker_share.current_share — bounded by the free cores', () => {
	const outer_flag = process.env[unit_worker_share.NESTED_KEY]

	beforeEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = ''
	})

	afterEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = outer_flag ?? ''
	})

	it('takes the smaller of the run share and the free cores', () => {
		const scarce = { cores: SCARCE_FREE, ...UNREAD_MEMORY }
		const ample = { cores: AMPLE_FREE, ...UNREAD_MEMORY }

		expect(unit_worker_share.current_share(MEASURED_CORES, 1, scarce)).toBe(SCARCE_FREE)
		expect(unit_worker_share.current_share(MEASURED_CORES, 1, ample)).toBe(PAIRED_SHARE)
	})

	it('is the run share alone where the machine could not be read', () => {
		expect(unit_worker_share.current_share(MEASURED_CORES, PAIRED_RUNS - 1)).toBe(PAIRED_SHARE)
		expect(unit_worker_share.current_share(MEASURED_CORES, 0)).toBeUndefined()
	})

	it('takes the workers the free memory holds when they are fewer', () => {
		const free = { cores: AMPLE_FREE, memory_workers: SCARCE_MEMORY_WORKERS }

		expect(unit_worker_share.current_share(MEASURED_CORES, 1, free)).toBe(SCARCE_FREE)
	})
})

// joshuafolkken/kit#4528: lanes running their suites at once sized workers from the cores alone, and
// their workers' memory piled up until the batch stopped opening lanes.
describe('unit_worker_share.cap_to_capacity — the free memory bounds the share too', () => {
	const unread_cores = { cores: undefined }

	it('takes the workers the free memory holds when they are fewer than the share', () => {
		const free = { ...unread_cores, memory_workers: SCARCE_MEMORY_WORKERS }

		expect(unit_worker_share.cap_to_capacity(PAIRED_SHARE, free, MEASURED_CORES)).toBe(SCARCE_FREE)
		expect(unit_worker_share.cap_to_capacity(undefined, free, MEASURED_CORES)).toBe(SCARCE_FREE)
	})

	it('keeps the share when the free memory holds every worker', () => {
		const free = { ...unread_cores, memory_workers: AMPLE_MEMORY_WORKERS }

		expect(unit_worker_share.cap_to_capacity(PAIRED_SHARE, free, MEASURED_CORES)).toBe(PAIRED_SHARE)
		expect(unit_worker_share.cap_to_capacity(undefined, free, MEASURED_CORES)).toBeUndefined()
	})

	// A platform `machine-capacity.ts` reads no memory on: the share stays as it was.
	it('keeps the share as it was where the memory could not be read', () => {
		const free = { ...unread_cores, ...UNREAD_MEMORY }

		expect(unit_worker_share.cap_to_capacity(PAIRED_SHARE, free, MEASURED_CORES)).toBe(PAIRED_SHARE)
		expect(unit_worker_share.cap_to_capacity(undefined, free, MEASURED_CORES)).toBeUndefined()
	})

	// The kernel's critical pressure reads as no memory free (`machine_capacity.pressured_available`).
	it('hands out one worker where no memory is free', () => {
		const free = { ...unread_cores, memory_workers: 0 }

		expect(unit_worker_share.cap_to_capacity(PAIRED_SHARE, free, MEASURED_CORES)).toBe(
			unit_worker_share.MIN_WORKERS,
		)
	})

	it('takes the smaller of the free cores and the free memory', () => {
		const free = { cores: SCARCE_FREE - 1, memory_workers: SCARCE_MEMORY_WORKERS }

		expect(unit_worker_share.cap_to_capacity(PAIRED_SHARE, free, MEASURED_CORES)).toBe(
			SCARCE_FREE - 1,
		)
	})
})

// joshuafolkken/kit#7551: four lanes, this run the only unit run, a load average past the cores — the
// free cores read zero — and the claim `gate-plan.ts` sizes from the same share: ⌊11 ÷ 4⌋ workers plus
// vitest itself.
const SHARING_LANES = 4
const LANE_SHARE = 2
const LOADED = { cores: 0, memory_workers: AMPLE_MEMORY_WORKERS }
const LANE_CLAIM = { weight: LANE_SHARE + unit_worker_share.MAIN_PROCESS_CORES }

function admitted_workers(
	free: FreeCapacity,
	claim: UnitClaim | undefined,
	live_lanes: number,
): number | undefined {
	const capacity = unit_worker_share.admitted_capacity(free, claim, 0, live_lanes)
	const share = unit_worker_share.current_share(MEASURED_CORES, 0, capacity, live_lanes)

	return unit_worker_share.cap_to_claim(share, claim)
}

describe('unit_worker_share.admitted_capacity — a sharing run keeps its admitted claim', () => {
	const outer_flag = process.env[unit_worker_share.NESTED_KEY]

	beforeEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = ''
	})

	afterEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = outer_flag ?? ''
	})

	it('keeps the claimed workers beside other lanes however loaded the machine reads', () => {
		expect(admitted_workers(LOADED, LANE_CLAIM, SHARING_LANES)).toBe(LANE_SHARE)
	})

	it('still bounds a sharing run by the free memory', () => {
		const short_of_memory = { cores: 0, memory_workers: unit_worker_share.MIN_WORKERS }

		expect(admitted_workers(short_of_memory, LANE_CLAIM, SHARING_LANES)).toBe(
			unit_worker_share.MIN_WORKERS,
		)
	})

	it('still cuts a sharing run that holds no claim to the free cores', () => {
		expect(admitted_workers(LOADED, undefined, SHARING_LANES)).toBe(unit_worker_share.MIN_WORKERS)
	})

	it('leaves a solo run bounded by the free cores as before', () => {
		const solo_claim = { weight: MEASURED_CORES }

		expect(unit_worker_share.admitted_capacity(LOADED, solo_claim, 0, 1)).toBe(LOADED)
		expect(admitted_workers(LOADED, solo_claim, 1)).toBe(unit_worker_share.MIN_WORKERS)
	})
})
