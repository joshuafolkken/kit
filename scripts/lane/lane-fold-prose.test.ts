import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_fold_prose } from './lane-fold-prose'

const FOLDED = '7945'
const STASH = '7945: uncommitted work at lane withdraw'
const REASON = 'ships with the wiring'

describe('lane_fold_prose.comment', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('names the stash to pop and the closes line in English', () => {
		vi.stubEnv('JOSH_SESSION_LANG', 'en')
		const text = lane_fold_prose.comment(FOLDED, STASH, REASON)

		expect(text).toContain(`stash:pop "${STASH}"`)
		expect(text).toContain(`closes #${FOLDED}`)
		expect(text).toContain(REASON)
	})

	it('names the stash to pop and the closes line in Japanese', () => {
		vi.stubEnv('JOSH_SESSION_LANG', 'ja')
		const text = lane_fold_prose.comment(FOLDED, STASH, REASON)

		expect(text).toContain('PR 本文')
		expect(text).toContain(`stash:pop "${STASH}"`)
		expect(text).toContain(`closes #${FOLDED}`)
	})

	it('writes no restore line when the folded lane held no work', () => {
		expect(lane_fold_prose.comment(FOLDED, undefined, REASON)).not.toContain('stash:pop')
	})
})

describe('lane_fold_prose.is_noted', () => {
	it('finds a note written for the same folded issue', () => {
		const bodies = ['plan', lane_fold_prose.comment(FOLDED, STASH, REASON)]

		expect(lane_fold_prose.is_noted(bodies, FOLDED)).toBe(true)
	})

	it('does not count a note for another folded issue', () => {
		const bodies = [lane_fold_prose.comment('7946', STASH, REASON)]

		expect(lane_fold_prose.is_noted(bodies, FOLDED)).toBe(false)
	})
})
