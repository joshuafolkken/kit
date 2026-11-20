import { describe, expect, it } from 'vitest'
import { cost_audit_wait_format } from './cost-audit-wait-format'

const TITLE_FIGURES = ' (this period: rewrites · cache write dollars · tokens)'

// joshuafolkken/kit#8308: the after-wait rewrite tables in the `cost:audit` report.
describe('cost_audit_wait_format.wait_lines', () => {
	it('prints each table under its key with every row', () => {
		const rows = [{ key: 'josh run:chain', count: 3, usd: 1.5, tokens: 200_000 }]

		expect(cost_audit_wait_format.wait_lines([{ by: 'preceding tool call', rows }])).toStrictEqual([
			'',
			`Rewrites after a wait of 5 min or more by preceding tool call${TITLE_FIGURES}`,
			'  josh run:chain: 3 · $1.5000 · 200,000 tokens',
		])
	})

	it('prints none for a table with no rewrite', () => {
		expect(cost_audit_wait_format.wait_lines([{ by: 'phase', rows: [] }])).toStrictEqual([
			'',
			`Rewrites after a wait of 5 min or more by phase${TITLE_FIGURES}`,
			'  none',
		])
	})
})
