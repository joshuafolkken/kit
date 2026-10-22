import { describe, expect, it } from 'vitest'
import { unit_worker_share } from './unit-worker-share'

// joshuafolkken/kit#4235: the share is read after admission, and was wider than the claim it ran on.
// joshuafolkken/kit#4362: the claim holds vitest's own process beside its workers, so the workers it
// bounds are the claim less that core.

const SHARE = 5
const WEIGHT = 3
const GRANTED = 2
const { MAIN_PROCESS_CORES, MIN_WORKERS } = unit_worker_share

describe('unit_worker_share.cap_to_claim', () => {
	it('caps a share wider than the claim at the claimed weight less vitest itself', () => {
		expect(unit_worker_share.cap_to_claim(SHARE, { weight: WEIGHT })).toBe(
			WEIGHT - MAIN_PROCESS_CORES,
		)
	})

	it('bounds a solo run admitted as asked by the claimed weight less vitest itself', () => {
		expect(unit_worker_share.cap_to_claim(undefined, { weight: WEIGHT })).toBe(
			WEIGHT - MAIN_PROCESS_CORES,
		)
	})

	it('bounds even a solo run by a narrowed claim', () => {
		const claim = { weight: WEIGHT, granted: GRANTED }

		expect(unit_worker_share.cap_to_claim(undefined, claim)).toBe(GRANTED - MAIN_PROCESS_CORES)
		expect(unit_worker_share.cap_to_claim(SHARE, claim)).toBe(GRANTED - MAIN_PROCESS_CORES)
	})

	it('never bounds a run below one worker, however narrow its claim', () => {
		expect(unit_worker_share.cap_to_claim(undefined, { weight: MIN_WORKERS })).toBe(MIN_WORKERS)
	})

	it('returns the share unchanged where no claim is held', () => {
		expect(unit_worker_share.cap_to_claim(SHARE, undefined)).toBe(SHARE)
	})
})
