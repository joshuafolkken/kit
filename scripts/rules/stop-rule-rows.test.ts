import { describe, expect, it } from 'vitest'
import { stop_rule_rows } from './stop-rule-rows'

// joshuafolkken/kit#4184: the `Stop` rows have no guard row, so each names `stop:guard` as its entry
// itself rather than falling back to `rule:guard`.

describe('stop_rule_rows.ROWS — the rows `stop:guard` delivers', () => {
	it.each(stop_rule_rows.ROWS.map((row) => [row.id, row] as const))(
		'%s is entered through stop:guard',
		(_id, row) => {
			expect(row.about.entry).toBe('pnpm josh stop:guard')
		},
	)
})
