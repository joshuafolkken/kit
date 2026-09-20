import { describe, expect, it } from 'vitest'
import type { CategoryResult, Priority } from './refactor-lint'
import { refactor_scan } from './refactor-scan'

const HIGH: Priority = 'high'
const SCOPE_PREFIX = 'scope: 12 files (seed 4,'
const CANDIDATES_VERDICT = 'verdict: candidates (1 high/medium)'

function category(candidate_count: number): CategoryResult {
	const candidates = Array.from({ length: candidate_count }, (_unused, index) => ({
		location: `scripts/a.ts:${String(index + 1)}`,
		rule: 'max-lines',
	}))

	return { key: 'lines-complexity', label: 'lines & complexity', priority: HIGH, candidates }
}

const EMPTY: CategoryResult = {
	key: 'type-safety',
	label: 'type safety',
	priority: HIGH,
	candidates: [],
}

describe('refactor_scan.total_candidates', () => {
	it('sums candidates across categories', () => {
		expect(refactor_scan.total_candidates([category(2), EMPTY])).toBe(2)
	})
})

describe('refactor_scan.verdict_token', () => {
	it('is clear when no category holds a candidate', () => {
		expect(refactor_scan.verdict_token([EMPTY])).toBe(refactor_scan.CLEAR)
	})

	it('is candidates when any category holds one', () => {
		expect(refactor_scan.verdict_token([category(1)])).toBe(refactor_scan.CANDIDATES)
	})
})

describe('refactor_scan.verdict_line', () => {
	it('reports clear with no count', () => {
		expect(refactor_scan.verdict_line([EMPTY])).toBe('verdict: clear')
	})

	it('reports the high/medium total when candidates remain', () => {
		expect(refactor_scan.verdict_line([category(2)])).toBe('verdict: candidates (2 high/medium)')
	})
})

describe('refactor_scan.category_block', () => {
	it('lists the header count and each candidate location', () => {
		expect(refactor_scan.category_block(category(1))).toBe(
			'high  lines & complexity: 1\n    scripts/a.ts:1 (max-lines)',
		)
	})
})

describe('refactor_scan.render', () => {
	it('opens with the scope line and ends with the verdict', () => {
		const rendered = refactor_scan.render([category(1)], 4, 12)

		expect(rendered.startsWith(SCOPE_PREFIX)).toBe(true)
		expect(rendered.endsWith(CANDIDATES_VERDICT)).toBe(true)
	})
})

describe('refactor_scan.error_output', () => {
	it('reports the error verdict rather than an empty (clear) result', () => {
		const rendered = refactor_scan.error_output(4, 12)

		expect(rendered.startsWith(SCOPE_PREFIX)).toBe(true)
		expect(rendered.endsWith(`verdict: ${refactor_scan.ERROR} (scan could not run)`)).toBe(true)
	})
})

describe('refactor_scan.render_result', () => {
	it('renders the error output when the verdict is error', () => {
		const result = { seed_count: 1, scope_count: 3, categories: [], verdict: refactor_scan.ERROR }

		expect(refactor_scan.render_result(result)).toContain('scan could not run')
	})

	it('renders the categories when the verdict is not error', () => {
		const categories = [category(1)]
		const result = { seed_count: 1, scope_count: 3, categories, verdict: refactor_scan.CANDIDATES }

		expect(refactor_scan.render_result(result)).toContain(CANDIDATES_VERDICT)
	})
})
