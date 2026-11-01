import { describe, expect, it } from 'vitest'
import { review_lint } from './review-lint'

const ROUND_ONE = 1
const ROUND_TWO = 2
const TRACE_LINE =
	'No issues — Traced an empty list → `[]` returned — confirmed because the loop never runs.'
const HIGH_FINDING = '- `src/foo.ts:42` (high) — the guard is inverted — negate it'
const LOW_FINDING = '- `src/foo.ts:9` (low) — a stale comment — reword it'
const SCENARIO_LINE = '  no failure scenario — tried an empty and a null input; both are guarded'
const CONVENTIONS_PROOF = 'No issues — `parse_ids` returns what its name says; tests sit beside it.'
const ASSUMPTION_ONE = '1. The API returns an array — a null breaks the map'
const ASSUMPTION_TWO = '2. The key exists in every locale — a missing one shows the key'
const FLOOR_LINE = 'Whether the regex covers a CRLF body — only LF inputs were traced.'
const BARE = 'No issues'

interface RoundOneBodies {
	readonly bug: ReadonlyArray<string>
	readonly security: ReadonlyArray<string>
	readonly performance: ReadonlyArray<string>
	readonly conventions: ReadonlyArray<string>
	readonly i18n: ReadonlyArray<string>
	readonly tests: ReadonlyArray<string>
	readonly comments: ReadonlyArray<string>
	readonly assumptions: ReadonlyArray<string>
	readonly floor: ReadonlyArray<string>
	readonly summary: ReadonlyArray<string>
}

const CONFORMING_BODIES: RoundOneBodies = {
	bug: [TRACE_LINE],
	security: [BARE],
	performance: [BARE],
	conventions: [CONVENTIONS_PROOF],
	i18n: [BARE],
	tests: ['No issues — every branch has a case in `foo.test.ts`.'],
	comments: [BARE],
	assumptions: [ASSUMPTION_ONE, ASSUMPTION_TWO],
	floor: [FLOOR_LINE],
	summary: ['0 high, 0 medium, 0 low — go'],
}

// The rubric's own category headings, numbered and with the `CLAUDE.md` note, in its order.
const HEADINGS: ReadonlyArray<readonly [keyof RoundOneBodies, string]> = [
	['bug', '1. Bug risks & logic errors'],
	['security', '2. Security'],
	['performance', 'Performance'],
	['conventions', 'Project conventions (`CLAUDE.md`)'],
	['i18n', 'i18n'],
	['tests', 'Tests'],
	['comments', 'Comments & content'],
	['assumptions', 'Assumptions audit'],
	['floor', 'Confidence floor'],
	['summary', 'Summary'],
]

function section(heading: string, ...body: ReadonlyArray<string>): ReadonlyArray<string> {
	return [`### ${heading}`, '', ...body, '']
}

function round_one(overrides: Partial<RoundOneBodies> = {}): string {
	const bodies = { ...CONFORMING_BODIES, ...overrides }

	return HEADINGS.flatMap(([key, heading]) => section(heading, ...bodies[key])).join('\n')
}

function lint(review: string, round: number = ROUND_ONE): ReadonlyArray<string> {
	return review_lint.lint_review(review, round)
}

function has_violation(violations: ReadonlyArray<string>, fragment: string): boolean {
	return violations.some((line) => line.includes(fragment))
}

// Whether a round-1 review with the given bodies swapped in reports a violation naming `fragment`.
function reports(overrides: Partial<RoundOneBodies>, fragment: string): boolean {
	return has_violation(lint(round_one(overrides)), fragment)
}

const LOW_WITHOUT_SCENARIO = 'low finding without'

describe('review_lint.lint_review — round 1 headings', () => {
	it('accepts a review that follows the template, numbered headings included', () => {
		expect(lint(round_one())).toEqual([])
	})

	it('reports a missing category heading and the unknown one in its place', () => {
		const review = round_one().replace('### i18n', '### Translations')

		expect(lint(review)).toEqual(
			expect.arrayContaining([
				'✖ missing heading: ### i18n',
				'✖ unexpected heading: ### Translations',
			]),
		)
	})

	it('reports headings written out of order', () => {
		const review = [...section('Summary', 'go'), round_one()].join('\n')

		expect(has_violation(lint(review), 'headings out of order')).toBe(true)
	})

	it('reports a heading with no verdict under it', () => {
		expect(lint(round_one({ performance: [] }))).toContain('✖ no verdict under ### Performance')
	})

	it('reports a review wrapped in a code fence', () => {
		expect(lint(`\`\`\`md\n${round_one()}\n\`\`\``)).toContain(
			'✖ the review is wrapped in a code fence — write it as plain markdown',
		)
	})
})

describe('review_lint.lint_review — round 1 verdicts', () => {
	it('reports a "No issues" on category 1 with no trace', () => {
		expect(reports({ bug: [BARE] }, 'without a trace')).toBe(true)
	})

	it('accepts a category-1 trace written as a list item', () => {
		const bug = ['No issues:', '- Traced an empty list → `[]` — confirmed because no loop runs']

		expect(lint(round_one({ bug }))).toEqual([])
	})

	it('reports a bare "No issues" where the rubric wants a proof statement', () => {
		expect(lint(round_one({ tests: [BARE] }))).toContain(
			'✖ bare "No issues" under ### Tests — say what was checked',
		)
	})

	it.each([[[ASSUMPTION_ONE]], [[ASSUMPTION_ONE, ASSUMPTION_TWO, '3. a', '4. b']]])(
		'reports an assumptions audit outside 2–3 items',
		(assumptions) => {
			expect(reports({ assumptions }, 'it needs 2–3')).toBe(true)
		},
	)

	it.each(['Nothing', 'No concerns.'])('reports a confidence floor of "%s"', (answer) => {
		const violations = lint(round_one({ floor: [answer] }))

		expect(has_violation(violations, 'name one concrete thing')).toBe(true)
	})
})

describe('review_lint.lint_review — round 1 findings', () => {
	it('accepts a cited high finding and a low one with its scenario line', () => {
		const bug = [HIGH_FINDING, '  also `src/bar.ts:3`', LOW_FINDING, SCENARIO_LINE]

		expect(lint(round_one({ bug }))).toEqual([])
	})

	it('reports a finding with no file:line citation', () => {
		const violations = lint(round_one({ security: ['- the token is logged (high) — drop it'] }))

		expect(has_violation(violations, 'without a `file:line` citation')).toBe(true)
	})

	it('reports a finding with no severity', () => {
		const violations = lint(round_one({ security: ['- `src/a.ts:1` — the token is logged'] }))

		expect(has_violation(violations, 'without a severity')).toBe(true)
	})

	it('reports a low finding with no "no failure scenario —" line', () => {
		expect(reports({ comments: [LOW_FINDING] }, LOW_WITHOUT_SCENARIO)).toBe(true)
	})

	it('reads only the first severity, so a high finding that mentions "(low)" needs no scenario', () => {
		const finding = '- `src/foo.ts:42` (high) — a (low) risk check is inverted — negate it'

		expect(lint(round_one({ bug: [finding] }))).toEqual([])
	})

	it('accepts a "- None" item as an empty category, not a finding', () => {
		expect(lint(round_one({ tests: ['- None — every branch has a case.'] }))).toEqual([])
	})

	it('accepts a confidence floor that only opens with "Nothing"', () => {
		const floor = ['Nothing in the parser worries me more than CRLF input.']

		expect(lint(round_one({ floor }))).toEqual([])
	})
})

describe('review_lint.lint_review — round 2', () => {
	const conforming = [
		...section(
			'First-round findings',
			'1. `src/foo.ts:42` (was high) — resolved — the guard is negated',
			'2. `src/bar.ts:8` (was medium) — **not resolved** (medium) — still unguarded',
		),
		...section('New findings in the fix delta', HIGH_FINDING),
		...section('Summary', '1 high, 1 medium — no-go'),
	].join('\n')

	it('accepts the verification-pass template without any category heading', () => {
		expect(lint(conforming, ROUND_TWO)).toEqual([])
	})

	it('requires the round-2 headings rather than the nine categories', () => {
		const violations = lint(round_one(), ROUND_TWO)

		expect(violations).toContain('✖ missing heading: ### First-round findings')
		expect(violations).not.toContain('✖ missing heading: ### Security')
	})

	it('reports a first-round line with no prior severity or resolution', () => {
		const violations = lint(conforming.replace('(was high) — resolved', 'is fine'), ROUND_TWO)

		expect(has_violation(violations, '"(was <severity>)"')).toBe(true)
		expect(has_violation(violations, '"resolved" or "not resolved"')).toBe(true)
	})

	it('accepts an empty fix delta written as "- None"', () => {
		expect(lint(conforming.replace(HIGH_FINDING, '- None'), ROUND_TWO)).toEqual([])
	})

	it('checks a new finding in the fix delta like a round-1 finding', () => {
		const delta_low = conforming.replace('(high) — the guard', '(low) — the guard')
		const violations = lint(delta_low, ROUND_TWO)

		expect(has_violation(violations, LOW_WITHOUT_SCENARIO)).toBe(true)
	})
})

describe('review_lint.lint_review — REVIEW TARGET MISMATCH', () => {
	it('asks no finding and no verdict of the stop reply', () => {
		expect(lint('REVIEW TARGET MISMATCH — the attest exited 1')).toEqual([])
	})

	it('reports headings carried beside the stop reply', () => {
		const violations = lint(`REVIEW TARGET MISMATCH\n\n${round_one()}`)

		expect(violations).toHaveLength(1)
		expect(violations[0]).toContain('carries no findings and no verdict')
	})
})

describe('review_lint.with_reference', () => {
	it('stays empty on a clean review', () => {
		expect(review_lint.with_reference([], ROUND_ONE)).toEqual([])
	})

	it('names the round-2 section of the rubric on a round-2 failure', () => {
		expect(review_lint.with_reference(['✖ x'], ROUND_TWO).at(-1)).toContain(
			'"The second round is a verification pass, not a second full review"',
		)
	})
})

// joshuafolkken/kit#5627: `review:lint` and `review:submit --review` print the same lines.
describe('review_lint.failures', () => {
	it('stays empty on a conforming review', () => {
		expect(review_lint.failures('REVIEW TARGET MISMATCH', ROUND_ONE)).toEqual([])
	})

	it('ends the violations with the rubric section of the round', () => {
		const failures = review_lint.failures('### Summary\n\ngo', ROUND_ONE)

		expect(failures).toContain('✖ missing heading: ### Bug risks & logic errors')
		expect(failures.at(-1)).toContain('"Review output format"')
	})
})
