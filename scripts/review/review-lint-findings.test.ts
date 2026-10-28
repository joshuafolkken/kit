import { describe, expect, it } from 'vitest'
import { review_lint_findings } from './review-lint-findings'
import type { ReviewSection } from './review-lint-sections'

const LOW_FINDING = '- `a.ts:1` (low) — p'

function section(...lines: ReadonlyArray<string>): ReviewSection {
	return { heading: 'Tests', lines }
}

describe('review_lint_findings.finding_blocks', () => {
	it('leaves a trace or a No issues item out of the findings', () => {
		const blocks = review_lint_findings.finding_blocks(
			section('- Traced x → y — confirmed because z', '- No issues here', LOW_FINDING),
		)

		expect(blocks).toEqual([LOW_FINDING])
	})
})

describe('review_lint_findings.finding_violations', () => {
	it('reads the scenario line from an indented continuation of a low finding', () => {
		const violations = review_lint_findings.finding_violations(
			section('- `a.ts:1-4` (low) — p — f', '  no failure scenario — tried an empty input'),
		)

		expect(violations).toEqual([])
	})

	it('names the heading and the finding line in each violation', () => {
		expect(review_lint_findings.finding_violations(section('- `a.ts:1` — p'))).toEqual([
			'✖ finding without a severity (high|medium|low) under ### Tests: - `a.ts:1` — p',
		])
	})
})

describe('review_lint_findings.first_round_violations', () => {
	it('accepts a first-round line with its prior severity and resolution', () => {
		const line = '1. `a.ts:1` (was medium) — **not resolved** (medium) — still open'

		expect(review_lint_findings.first_round_violations(section(line))).toEqual([])
	})

	it('reports a first-round line with no file:line citation', () => {
		const violations = review_lint_findings.first_round_violations(
			section('1. the guard (was high) — resolved'),
		)

		expect(violations).toEqual([
			'✖ first-round line without a `file:line` citation under ### Tests: 1. the guard (was high) — resolved',
		])
	})
})
