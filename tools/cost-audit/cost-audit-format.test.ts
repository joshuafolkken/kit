import { describe, expect, it } from 'vitest'
import type { Audit, AuditRow } from './cost-audit'
import { cost_audit_format } from './cost-audit-format'

function row(key: string, current: number, previous: number, is_regression = false): AuditRow {
	return { key, current, previous, is_regression }
}

const NO_REWRITES = { after_wait: { count: 0, usd: 0 }, within_ttl: { count: 0, usd: 0 } }

function audit_with(overrides: Partial<Audit> = {}): Audit {
	return {
		days: 7,
		total: row('total', 12, 10),
		merges: undefined,
		per_merge: undefined,
		kinds: [],
		tools: [],
		guards: [],
		rewrites: { current: NO_REWRITES, previous: NO_REWRITES },
		...overrides,
	}
}

describe('cost_audit_format.report_lines — the full cache rewrites', () => {
	it('prints the rewrites after a wait and within the TTL beside the previous period', () => {
		const current = { after_wait: { count: 631, usd: 182 }, within_ttl: { count: 2, usd: 0.5 } }
		const lines = cost_audit_format.report_lines(
			audit_with({ rewrites: { current, previous: NO_REWRITES } }),
		)

		expect(lines).toContain('  after a wait of 5 min or more: 631 ($182.0000) (prev 0 ($0.0000))')
		expect(lines).toContain('  within 5 min: 2 ($0.5000) (prev 0 ($0.0000))')
	})
})

describe('cost_audit_format.report_lines — the printed report', () => {
	it('prints each row with its change against the previous period', () => {
		const lines = cost_audit_format.report_lines(audit_with({ kinds: [row('fullrun', 9, 12)] }))

		expect(lines).toContain('  total: $12.0000 (prev $10.0000, +20.0%)')
		expect(lines).toContain('  fullrun: $9.0000 (prev $12.0000, -25.0%)')
	})

	it('marks a row with no previous figure as new, and an empty section as none', () => {
		const lines = cost_audit_format.report_lines(audit_with({ tools: [row('edit', 2, 0)] }))

		expect(lines).toContain('  edit: $2.0000 (prev $0.0000, new)')
		expect(lines).toContain('  none')
	})

	it('says the merges were not read when GitHub could not be reached', () => {
		const lines = cost_audit_format.report_lines(audit_with())

		expect(lines).toContain('  merges: not read from GitHub')
		expect(lines.at(-1)).toBe('Regressions: none')
	})

	it('flags a regression on its row and names it by section in the closing list', () => {
		const audit = audit_with({
			merges: { current: 2, previous: 4 },
			per_merge: row('per merge', 6, 2.5, true),
			guards: [row('batching', 3, 1, true)],
		})
		const lines = cost_audit_format.report_lines(audit)

		expect(lines).toContain('  merges: 2 (prev 4)')
		expect(lines).toContain('  batching: $3.0000 (prev $1.0000, +200.0%)  regression')
		expect(lines.at(-1)).toBe('Regressions: per merge, guard batching')
	})
})

describe('cost_audit_format.summary_line — the line josh retrospective carries', () => {
	it('gives the total, its change and the regressions', () => {
		expect(cost_audit_format.summary_line(audit_with())).toBe(
			'Cost audit (7d): $12.0000 (+20.0%); regressions: none',
		)
	})

	it('adds the cost per merge when the merges were read', () => {
		const audit = audit_with({ per_merge: row('per merge', 6, 5) })

		expect(cost_audit_format.summary_line(audit)).toBe(
			'Cost audit (7d): $12.0000 (+20.0%), $6.0000 per merge; regressions: none',
		)
	})
})

describe('cost_audit_format.filing_lines — a regression is a filing the retrospective owes', () => {
	it('names every regression and the command that reproduces it', () => {
		const audit = audit_with({ guards: [row('batching', 3, 1, true)] })

		expect(cost_audit_format.filing_lines(audit)).toStrictEqual([
			'File a cost regression: guard batching — reproduce with `pnpm josh cost:audit`',
		])
	})

	it('adds nothing when no row regressed', () => {
		expect(cost_audit_format.filing_lines(audit_with())).toStrictEqual([])
	})
})
