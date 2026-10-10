import { describe, expect, it } from 'vitest'
import type { Metrics } from './metrics-logic'
import { metrics_ratchet, type Approval } from './metrics-ratchet'

const REASON = 'New guard for #1'
const DATE = '2026-10-08'
const COMMIT = 'abc1234'
const GUARDS = 'guards'
const RULE_LINES = 'rules.lines'
const COMMENT_RATIO = 'scripts.comment_ratio'
const NOT_JSON = '{ not json'

const BASE: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
}

function metrics_with(overrides: Partial<Metrics>): Metrics {
	return { ...BASE, ...overrides }
}

function approval_of(growth: Record<string, number>): Approval {
	return { reason: REASON, date: DATE, growth }
}

describe('metrics_ratchet.compare', () => {
	it('fails on a grown total, naming its merge-base value, its current value and the growth', () => {
		const verdict = metrics_ratchet.compare(BASE, metrics_with({ guards: 6 }), [])

		expect(verdict).toStrictEqual({
			kind: 'regressed',
			regressions: [{ name: GUARDS, base: 5, current: 6, growth: 1, approved: 0 }],
		})
	})

	it('reports a growth even when another total shrank', () => {
		const current = metrics_with({ guards: 4, rules: { files: 3, lines: 201 } })
		const verdict = metrics_ratchet.compare(BASE, current, [])

		expect(verdict).toMatchObject({ kind: 'regressed', regressions: [{ name: RULE_LINES }] })
	})

	it('answers shrank when a total went down and none went up', () => {
		const current = metrics_with({ rules: { files: 3, lines: 190 } })

		expect(metrics_ratchet.compare(BASE, current, [])).toStrictEqual({ kind: 'shrank' })
	})

	// The shrink is held by the merge-base that carries it, with nothing recorded.
	it('fails on a return to the total a merged shrink left behind', () => {
		const shrunk = metrics_with({ rules: { files: 3, lines: 190 } })

		expect(metrics_ratchet.compare(shrunk, BASE, []).kind).toBe('regressed')
	})

	it('answers unchanged when no compared total moved', () => {
		const current = metrics_with({ scripts: { ...BASE.scripts, files: 11, comment_lines: 401 } })

		expect(metrics_ratchet.compare(BASE, current, [])).toStrictEqual({ kind: 'unchanged' })
	})

	it('fails on a single byte of AI-cost growth, resident or on demand', () => {
		const resident = metrics_with({ ai_cost: { ...BASE.ai_cost, resident_bytes: 9001 } })
		const on_demand = metrics_with({ ai_cost: { ...BASE.ai_cost, on_demand_bytes: 300_001 } })

		expect(metrics_ratchet.compare(BASE, resident, []).kind).toBe('regressed')
		expect(metrics_ratchet.compare(BASE, on_demand, []).kind).toBe('regressed')
	})
})

describe('metrics_ratchet.compare with approvals', () => {
	const grown = metrics_with({ guards: 7 })

	it('passes a growth an approval covers', () => {
		const approvals = [approval_of({ [GUARDS]: 2 })]

		expect(metrics_ratchet.compare(BASE, grown, approvals)).toStrictEqual({ kind: 'approved' })
	})

	it('fails a growth past the approved amount, naming what was approved', () => {
		const verdict = metrics_ratchet.compare(BASE, grown, [approval_of({ [GUARDS]: 1 })])

		expect(verdict).toStrictEqual({
			kind: 'regressed',
			regressions: [{ name: GUARDS, base: 5, current: 7, growth: 2, approved: 1 }],
		})
	})

	it('fails a growth the approval does not name', () => {
		const approvals = [approval_of({ [RULE_LINES]: 50 })]

		expect(metrics_ratchet.compare(BASE, grown, approvals).kind).toBe('regressed')
	})

	// Merging the default branch in moves the merge-base and the branch by the same amount.
	it('still passes once both sides moved by what landed on the default branch', () => {
		const approvals = [approval_of({ [GUARDS]: 2 })]
		const verdict = metrics_ratchet.compare(
			metrics_with({ guards: 9 }),
			metrics_with({ guards: 11 }),
			approvals,
		)

		expect(verdict).toStrictEqual({ kind: 'approved' })
	})

	it('covers a comment ratio that rose from 0.40 to 0.41 with a growth of 0.01', () => {
		const current = metrics_with({ scripts: { ...BASE.scripts, comment_ratio: 0.41 } })
		const approvals = [approval_of({ [COMMENT_RATIO]: 0.01 })]

		expect(metrics_ratchet.compare(BASE, current, approvals)).toStrictEqual({ kind: 'approved' })
	})
})

describe('metrics_ratchet.accept', () => {
	it('records the growth of the totals that grew, and of no other', () => {
		const current = metrics_with({
			guards: 6,
			rules: { files: 3, lines: 190 },
			scripts: { ...BASE.scripts, files: 12, comment_ratio: 0.41 },
		})

		expect(metrics_ratchet.accept(BASE, current, REASON, DATE)).toStrictEqual({
			reason: REASON,
			date: DATE,
			growth: { [COMMENT_RATIO]: 0.01, [GUARDS]: 1 },
		})
	})

	it('records nothing when no total grew', () => {
		const current = metrics_with({ rules: { files: 3, lines: 190 } })

		expect(metrics_ratchet.accept(BASE, current, REASON, DATE)).toBeUndefined()
		expect(metrics_ratchet.accept(BASE, BASE, REASON, DATE)).toBeUndefined()
	})

	it('writes an approval the comparison then accepts', () => {
		const current = metrics_with({ guards: 6 })
		const approval = metrics_ratchet.accept(BASE, current, REASON, DATE)
		const approvals = approval === undefined ? [] : [approval]

		expect(metrics_ratchet.compare(BASE, current, approvals)).toStrictEqual({ kind: 'approved' })
	})
})

describe('metrics_ratchet approval files', () => {
	const approval = approval_of({ [GUARDS]: 1 })
	const text = metrics_ratchet.approval_text(approval)

	it('round-trips an approval through its file text', () => {
		expect(text.endsWith('}\n')).toBe(true)
		expect(metrics_ratchet.parse_approval(text)).toStrictEqual(approval)
	})

	it('reads nothing out of a file that is not an approval', () => {
		expect(metrics_ratchet.parse_approval(NOT_JSON)).toBeUndefined()
		expect(metrics_ratchet.parse_approval('{"reason":"x"}')).toBeUndefined()
	})

	it('keeps an approval the merge-base does not hold, new or rewritten', () => {
		const rewritten = metrics_ratchet.approval_text(approval_of({ [GUARDS]: 3 }))
		const current = new Map([
			['1.json', text],
			['2.json', rewritten],
		])
		const base = new Map([['2.json', text]])

		expect(metrics_ratchet.fresh_approvals(current, base)).toStrictEqual([
			approval,
			approval_of({ [GUARDS]: 3 }),
		])
	})

	it('drops an approval the merge-base already holds unchanged, and one that does not parse', () => {
		const current = new Map([
			['1.json', text],
			['2.json', NOT_JSON],
		])
		const base = new Map([['1.json', text]])

		expect(metrics_ratchet.fresh_approvals(current, base)).toStrictEqual([])
	})
})

describe('metrics_ratchet.parse_metrics', () => {
	it('reads the totals the --json form prints', () => {
		expect(metrics_ratchet.parse_metrics(JSON.stringify(BASE))).toStrictEqual(BASE)
	})

	it('reads nothing out of output that is not the totals', () => {
		expect(metrics_ratchet.parse_metrics('')).toBeUndefined()
		expect(metrics_ratchet.parse_metrics(JSON.stringify({ guards: 5 }))).toBeUndefined()
	})
})

describe('metrics_ratchet.render_regressions', () => {
	it('names each grown total, the commit it is measured from and the way past it', () => {
		const regressions = [{ name: GUARDS, base: 5, current: 7, growth: 2, approved: 1 }]

		expect(metrics_ratchet.render_regressions(regressions, COMMIT)).toBe(
			[
				'josh metrics: 1 total(s) grew past the merge-base abc1234:',
				'  guards  merge-base 5 → current 7 (+2, approved +1)',
				'Bring them back down, or record the reason they grew: pnpm josh metrics --accept --reason "<why>"',
			].join('\n'),
		)
	})
})
