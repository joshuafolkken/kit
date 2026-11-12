import type { RoleTotals } from '#tools/cost/cost-run-roles'
import { describe, expect, it } from 'vitest'
import { retrospective_picks, type PickInputs } from './retrospective-picks'

const REGRESSION_LINE =
	'File a cost regression: total, per merge — reproduce with `pnpm josh cost:audit`'

// A role at the two shares the ranking reads; the rest of the totals are unused.
function waiting_role(
	name: RoleTotals['role'],
	cost_share: number,
	elapsed_share: number,
): RoleTotals {
	return {
		role: name,
		session_count: 1,
		request_count: 1,
		output_tokens: 0,
		cost_usd: 0,
		composition: {
			input_usd: 0,
			cache_write_5m_usd: 0,
			cache_write_1h_usd: 0,
			cache_read_usd: 0,
			output_usd: 0,
			total_usd: 0,
			unpriced_models: [],
		},
		preamble_tokens: 0,
		cost_share,
		elapsed_share,
		elapsed_ms: 0,
	}
}

function inputs(overrides: Partial<PickInputs>): PickInputs {
	return {
		audit_summary: 'Cost audit (7d): $12.0000 (+1.0%)',
		guards: [],
		waiting: [],
		findings: [],
		ship_stops: new Map(),
		...overrides,
	}
}

const FULL = inputs({
	audit_summary: `Cost audit (7d): $12.0000 (+30.0%); regressions: total\n${REGRESSION_LINE}`,
	guards: [
		{ guard: 'batching', refusals: 2, stops: 0, rephrased: 0, usd: 0.5 },
		{ guard: 'lane plan', refusals: 1, stops: 0, rephrased: 0, usd: 3 },
		{ guard: "unsafe `sed -i` on $HOME's file", refusals: 4, stops: 1, rephrased: 0, usd: 1.25 },
	],
	waiting: [waiting_role('wake', 0.25, 0.52)],
	findings: [
		{ category: 'bug-risks', count: 3 },
		{ category: 'i18n', count: 1 },
	],
	ship_stops: new Map([
		['gate', 2],
		['review', 1],
	]),
})

describe('retrospective_picks.rank', () => {
	it('orders a cost regression first, then guards by cost, waiting roles, findings and ship stops', () => {
		expect(retrospective_picks.rank(FULL).map((pick) => pick.title)).toStrictEqual([
			'Fix cost regression in 2 cost:audit row(s)',
			"Reduce unsafe `sed -i` on $HOME's file guard friction",
			'Reduce batching guard friction',
			'Cut wake waiting time',
			'Prevent recurring bug-risks review findings',
			'Reduce ship stops at gate',
		])
	})

	it('drops a guard, finding or ship stop seen only once', () => {
		const titles = retrospective_picks.rank(FULL).map((pick) => pick.title)

		expect(titles).not.toContain('Reduce lane plan guard friction')
		expect(titles).not.toContain('Prevent recurring i18n review findings')
		expect(titles).not.toContain('Reduce ship stops at review')
	})
})

describe('retrospective_picks.report_lines', () => {
	// The second title carries a backtick, a `$` and a quote: single-quoted, the printed line files it
	// verbatim instead of running a command substitution.
	it('prints the top two with their shell-safe issue:file line and stacks the rest', () => {
		expect(retrospective_picks.report_lines(FULL)).toStrictEqual([
			'Improvement picks (ranked by effect):',
			`  1. Fix cost regression in 2 cost:audit row(s) — ${REGRESSION_LINE}`,
			"     pnpm josh issue:file 'Fix cost regression in 2 cost:audit row(s)' --body-file <body.md>",
			"  2. Reduce unsafe `sed -i` on $HOME's file guard friction — 4 refused, 1 stopped, $1.2500",
			"     pnpm josh issue:file 'Reduce unsafe `sed -i` on $HOME'\\''s file guard friction' --body-file <body.md>",
			'  stack: Reduce batching guard friction — 2 refused, 0 stopped, $0.5000',
			'  stack: Cut wake waiting time — time share 27 points ahead of cost share',
			'  stack: Prevent recurring bug-risks review findings — 3 finding(s)',
			'  stack: Reduce ship stops at gate — 2 stop(s)',
		])
	})

	it('says none when no measurement marks friction', () => {
		expect(retrospective_picks.report_lines(inputs({}))).toStrictEqual(['Improvement picks: none'])
	})
})
