import { describe, expect, it } from 'vitest'
import { cost_run_issues } from './cost-run-issues'
import type { SessionRow } from './cost-run-roles'

function row(
	session_id: string,
	issue: number | undefined,
	overrides: Partial<SessionRow> = {},
): SessionRow {
	return {
		session_id,
		role: 'lane',
		issue,
		parent_id: undefined,
		depth: 1,
		is_readable: true,
		is_measured: true,
		cost_usd: 1,
		elapsed_ms: 1000,
		request_count: 10,
		output_tokens: 100,
		preamble_tokens: 100,
		took_cut: false,
		...overrides,
	}
}

describe('cost_run_issues.build', () => {
	it('sums every session that names an Issue and marks it cut when any session took the cut', () => {
		const issues = cost_run_issues.build([
			row('L1', 3223, { cost_usd: 2, took_cut: true }),
			row('L1b', 3223, { cost_usd: 1.5, request_count: 5, elapsed_ms: 500 }),
			row('S1', 3223, { role: 'subagent', cost_usd: 0.5 }),
		])

		expect(issues).toEqual([
			{
				issue: 3223,
				session_count: 3,
				cost_usd: 4,
				request_count: 25,
				elapsed_ms: 2500,
				took_cut: true,
				is_measured: true,
			},
		])
	})
})

describe('cost_run_issues.build edges', () => {
	it('leaves an Issue no session of which took the cut unmarked', () => {
		const [issue] = cost_run_issues.build([row('L1', 3224), row('L1b', 3224)])

		expect(issue?.took_cut).toBe(false)
	})

	it('leaves out sessions that name no Issue and orders the rest by Issue number', () => {
		const issues = cost_run_issues.build([
			row('p', undefined, { role: 'parent' }),
			row('L2', 3230),
			row('L1', 3222),
		])

		expect(issues.map((totals) => totals.issue)).toEqual([3222, 3230])
	})

	it('reads an Issue with an unmeasured session as not measured', () => {
		const [issue] = cost_run_issues.build([
			row('L1', 3223),
			row('L1b', 3223, { is_measured: false }),
		])

		expect(issue?.is_measured).toBe(false)
	})
})
