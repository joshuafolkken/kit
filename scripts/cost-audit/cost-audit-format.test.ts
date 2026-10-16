import { describe, expect, it } from 'vitest'
import type { Audit, AuditRow } from './cost-audit'
import { cost_audit_format } from './cost-audit-format'

function row(key: string, current: number, previous: number, is_regression = false): AuditRow {
	return { key, current, previous, is_regression }
}

function audit_with(overrides: Partial<Audit> = {}): Audit {
	return {
		days: 7,
		total: row('total', 12, 10),
		merges: undefined,
		per_merge: undefined,
		kinds: [],
		tools: [],
		guards: [],
		...overrides,
	}
}

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
