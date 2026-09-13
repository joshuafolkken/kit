import { read_repo_file } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'

// joshuafolkken/kit#1927: `/code-review` runs in a forked process that reads none of this
// repository's documents, so the severity tests, the nine categories and the output format have to
// reach it as a file the brief points at. This suite is the acceptance check that they are in that
// file and that the brief points at it — the two halves of "the rubric is handed to the reviewer".

const RUBRIC = read_repo_file(review_brief.RUBRIC_RELATIVE_PATH)

// The nine category headings the first round must check. A reviewer given a rubric missing one of
// them would silently stop checking that category — the failure this file exists to catch.
const CATEGORY_HEADINGS: ReadonlyArray<string> = [
	'### 1. Bug risks & logic errors',
	'### 2. Security',
	'### 3. Performance',
	'### 4. Project conventions',
	'### 5. i18n',
	'### 6. Tests',
	'### 7. Comments & content',
	'### 8. Assumptions audit',
	'### 9. Confidence floor',
]

describe('the rubric file carries the severity criteria', () => {
	// The two tests that decide `medium` — both have to be present, because a rubric with only the
	// first would let a finding with no failure scenario block a round.
	it('states the reaches-something-real test', () => {
		expect(RUBRIC).toContain('It reaches something real')
	})

	it('states the concrete-failure-scenario test', () => {
		expect(RUBRIC).toContain('You can write the concrete failure scenario')
	})

	it('states that both must hold for medium or higher', () => {
		expect(RUBRIC).toContain('`medium` or higher only when both')
	})
})

describe('the rubric file carries every category the review must check', () => {
	it.each([...CATEGORY_HEADINGS])('carries %s', (heading) => {
		expect(RUBRIC).toContain(heading)
	})

	// The output format and stop conditions travel with the categories: a reviewer that read the
	// rubric but not the format would report findings the run cannot parse.
	it('carries the output format and the stop conditions', () => {
		expect(RUBRIC).toContain('## Review output format')
		expect(RUBRIC).toContain('## Stop conditions')
	})
})

describe('the brief points the reviewer at the rubric file', () => {
	const ROOT = '/lanes/1927'

	it('names the rubric under the briefed checkout root', () => {
		expect(review_brief.rubric_line(ROOT)).toContain(`${ROOT}/${review_brief.RUBRIC_RELATIVE_PATH}`)
	})

	it('tells the reviewer to read and apply it', () => {
		const line = review_brief.rubric_line(ROOT)

		expect(line).toContain('read')
		expect(line).toContain('apply')
	})

	// The integration half: `compose` must actually place the rubric line in the brief. Testing
	// `rubric_line` alone would still pass if someone dropped it from `compose`'s output.
	it('composes the rubric line into the brief', () => {
		const changed_file = 'a.ts'
		const brief = review_brief.compose({
			level: 'medium',
			round: 1,
			tree: { [changed_file]: 'x' },
			stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
			checkout: { root: ROOT, branch: '1927-lane', head: '0'.repeat(40) },
			nonce: 'deadbeefcafef00d',
			base: 'f'.repeat(40),
		})

		expect(brief).toContain(review_brief.rubric_line(ROOT))
	})
})
