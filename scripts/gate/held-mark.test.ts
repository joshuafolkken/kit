import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { held_mark } from './held-mark'

// joshuafolkken/kit#3945: a child reads the key of the claim its parent command holds for it, so the
// free-cores reading can leave that claim out. Cleared per case, because this suite itself runs under a
// `josh test:unit` that holds one.

const OWN_KEY = 'josh-core-reserved-own.json'
const OUTER_KEY = 'josh-core-reserved-outer.json'

beforeEach(() => {
	vi.stubEnv(held_mark.HELD_KEY, '')
	vi.stubEnv(held_mark.HELD_RESERVATION_KEY, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('held_mark.with_held_mark', () => {
	it('names the held claim while the run lasts', async () => {
		const seen = await held_mark.with_held_mark(async () => held_mark.held_reservation(), OWN_KEY)

		expect(seen).toBe(OWN_KEY)
		expect(held_mark.held_reservation()).toBeUndefined()
	})

	it('names no claim where the holder covers its children with several', async () => {
		const seen = await held_mark.with_held_mark(async () => held_mark.held_reservation())

		expect(seen).toBeUndefined()
	})

	it("restores the outer holder's claim afterwards", async () => {
		vi.stubEnv(held_mark.HELD_RESERVATION_KEY, OUTER_KEY)

		await held_mark.with_held_mark(async () => {
			await Promise.resolve()
		}, OWN_KEY)

		expect(held_mark.held_reservation()).toBe(OUTER_KEY)
	})
})
