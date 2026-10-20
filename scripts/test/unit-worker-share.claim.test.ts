import { describe, expect, it } from 'vitest'
import { unit_worker_share } from './unit-worker-share'

// joshuafolkken/kit#4235: the share is read after admission, and was wider than the claim it ran on.

const SHARE = 5
const WEIGHT = 3
const GRANTED = 2

describe('unit_worker_share.cap_to_claim', () => {
	it('caps a share wider than the claim at the claimed weight', () => {
		expect(unit_worker_share.cap_to_claim(SHARE, { weight: WEIGHT })).toBe(WEIGHT)
	})

	it('bounds a solo run admitted as asked by the claimed weight', () => {
		expect(unit_worker_share.cap_to_claim(undefined, { weight: WEIGHT })).toBe(WEIGHT)
	})

	it('bounds even a solo run by a narrowed claim', () => {
		const claim = { weight: WEIGHT, granted: GRANTED }

		expect(unit_worker_share.cap_to_claim(undefined, claim)).toBe(GRANTED)
		expect(unit_worker_share.cap_to_claim(SHARE, claim)).toBe(GRANTED)
	})

	it('returns the share unchanged where no claim is held', () => {
		expect(unit_worker_share.cap_to_claim(SHARE, undefined)).toBe(SHARE)
	})
})
