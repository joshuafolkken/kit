import { describe, expect, it } from 'vitest'
import { tally } from './tally'

// joshuafolkken/kit#7883: the count both the moved-test match and the rename match spend from.

describe('tally — a count per key, spent one at a time', () => {
	it('spends a key as often as it occurred, and no more', () => {
		const counts = tally.of(['a', 'a', 'b'])

		expect([
			tally.take(counts, 'a'),
			tally.take(counts, 'a'),
			tally.take(counts, 'a'),
		]).toStrictEqual([true, true, false])
		expect(tally.take(counts, 'c')).toBe(false)
	})
})
