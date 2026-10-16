import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unit_worker_share } from './unit-worker-share'

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
		expect(unit_worker_share.current_share(MEASURED_CORES, 1, SCARCE_FREE)).toBe(SCARCE_FREE)
		expect(unit_worker_share.current_share(MEASURED_CORES, 1, AMPLE_FREE)).toBe(PAIRED_SHARE)
	})

	it('is the run share alone where the machine could not be read', () => {
		expect(unit_worker_share.current_share(MEASURED_CORES, PAIRED_RUNS - 1)).toBe(PAIRED_SHARE)
		expect(unit_worker_share.current_share(MEASURED_CORES, 0)).toBeUndefined()
	})
})
