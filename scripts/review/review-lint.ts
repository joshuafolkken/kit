import { markdown_shape } from '#scripts/report/markdown-shape'
import { review_lint_findings } from './review-lint-findings'
import { review_lint_sections, type ReviewSection } from './review-lint-sections'

// `prompts/review-rubric.md` states every requirement of a review's output in a form a machine can
// read, yet only the next round or a person ever checked one. This checks them: the heading set and
// its order, a verdict under every heading, the trace behind a `No issues` on category 1, the 2–3
// assumptions, the Confidence floor's banned answers, and each finding's citation and severity. Whether
// a finding is right stays the judgement half.

const BUG_RISKS = 'Bug risks & logic errors'
const ASSUMPTIONS = 'Assumptions audit'
const CONFIDENCE_FLOOR = 'Confidence floor'
const SUMMARY = 'Summary'
const FIRST_ROUND_FINDINGS = 'First-round findings'
const NEW_FINDINGS = 'New findings in the fix delta'
const SECOND_ROUND = 2

const SECURITY = 'Security'
const PERFORMANCE = 'Performance'
const I18N = 'i18n'
const COMMENTS = 'Comments & content'

// "Review categories" in its order; the first seven carry findings, the last two their own shape.
const FINDING_CATEGORIES = [
	BUG_RISKS,
	SECURITY,
	PERFORMANCE,
	'Project conventions',
	I18N,
	'Tests',
	COMMENTS,
]
const FINDING_CATEGORY_SET: ReadonlySet<string> = new Set(FINDING_CATEGORIES)
const ROUND_ONE_HEADINGS = [...FINDING_CATEGORIES, ASSUMPTIONS, CONFIDENCE_FLOOR, SUMMARY]
// The categories the rubric lets answer a bare `No issues` when nothing was there to check.
const BARE_NO_ISSUES_ALLOWED: ReadonlySet<string> = new Set([SECURITY, PERFORMANCE, I18N, COMMENTS])
// Round 2 reads category 1 and the categories its fix delta touches, so no category heading is
// required there: its template is these three headings alone.
const ROUND_TWO_HEADINGS = [FIRST_ROUND_FINDINGS, NEW_FINDINGS, SUMMARY]
const BARE_NO_ISSUES = /^No issues\.?$/u
const NO_ISSUES = /\bNo issues\b/u
const TRACE = /Traced .+ → .+ — (?:confirmed|flagged) because \S/u
const MIN_ASSUMPTIONS = 2
const MAX_ASSUMPTIONS = 3
// The banned answers stand alone; a sentence that only opens with "Nothing" names something.
const BANNED_FLOOR = /^(?:Nothing|No concerns)\.?$/iu
const TARGET_MISMATCH = 'REVIEW TARGET MISMATCH'
const RUBRIC = 'prompts/review-rubric.md'
const ROUND_ONE_SECTION = 'Review output format'
const ROUND_TWO_SECTION = 'The second round is a verification pass, not a second full review'

function section_named(
	sections: ReadonlyArray<ReviewSection>,
	heading: string,
): ReviewSection | undefined {
	return sections.find((section) => section.heading === heading)
}

function missing_heading_violations(
	headings: ReadonlyArray<string>,
	expected: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return expected
		.filter((heading) => !headings.includes(heading))
		.map((heading) => `✖ missing heading: ### ${heading}`)
}

function unexpected_heading_violations(
	headings: ReadonlyArray<string>,
	expected: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return headings
		.filter((heading) => !expected.includes(heading))
		.map((heading) => `✖ unexpected heading: ### ${heading}`)
}

// The known headings, as written, must read as the expected list with the missing ones left out — a
// swap or a repeat breaks that, a missing heading alone does not.
function order_violation(
	headings: ReadonlyArray<string>,
	expected: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const written = headings.filter((heading) => expected.includes(heading)).join(' → ')
	if (written === expected.filter((heading) => headings.includes(heading)).join(' → ')) return []

	return [`✖ headings out of order or repeated — expected: ${expected.join(' → ')}`]
}

function heading_violations(
	sections: ReadonlyArray<ReviewSection>,
	expected: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const headings = sections.map((section) => section.heading)

	return [
		...missing_heading_violations(headings, expected),
		...unexpected_heading_violations(headings, expected),
		...order_violation(headings, expected),
	]
}

function verdict_violations(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	return sections
		.filter((section) => !review_lint_sections.has_content(section))
		.map((section) => `✖ no verdict under ### ${section.heading}`)
}

function bare_no_issues_violations(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	return sections
		.filter((section) => FINDING_CATEGORY_SET.has(section.heading))
		.filter((section) => !BARE_NO_ISSUES_ALLOWED.has(section.heading))
		.filter((section) => BARE_NO_ISSUES.test(review_lint_sections.body_text(section)))
		.map((section) => `✖ bare "No issues" under ### ${section.heading} — say what was checked`)
}

function trace_violation(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	const section = section_named(sections, BUG_RISKS)
	if (section === undefined || review_lint_findings.finding_blocks(section).length > 0) return []

	const body = review_lint_sections.body_text(section)
	if (!NO_ISSUES.test(body) || TRACE.test(body)) return []

	return [
		`✖ "No issues" under ### ${BUG_RISKS} without a trace — Traced <input> → <result> — confirmed/flagged because <reason>`,
	]
}

function assumptions_violation(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	const section = section_named(sections, ASSUMPTIONS)
	if (section === undefined) return []

	const count = review_lint_sections.item_blocks(section.lines).length
	if (count >= MIN_ASSUMPTIONS && count <= MAX_ASSUMPTIONS) return []

	return [
		`✖ ### ${ASSUMPTIONS} lists ${String(count)} assumptions — it needs ${String(MIN_ASSUMPTIONS)}–${String(MAX_ASSUMPTIONS)}`,
	]
}

function confidence_floor_violation(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	const section = section_named(sections, CONFIDENCE_FLOOR)

	if (section === undefined || !BANNED_FLOOR.test(review_lint_sections.body_text(section))) {
		return []
	}

	return [`✖ ### ${CONFIDENCE_FLOOR} answers "Nothing" or "No concerns" — name one concrete thing`]
}

function category_finding_violations(
	sections: ReadonlyArray<ReviewSection>,
): ReadonlyArray<string> {
	return sections
		.filter((section) => FINDING_CATEGORY_SET.has(section.heading))
		.flatMap((section) => review_lint_findings.finding_violations(section))
}

function round_one_violations(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	return [
		...heading_violations(sections, ROUND_ONE_HEADINGS),
		...verdict_violations(sections),
		...bare_no_issues_violations(sections),
		...trace_violation(sections),
		...assumptions_violation(sections),
		...confidence_floor_violation(sections),
		...category_finding_violations(sections),
	]
}

function delta_violations(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	const first_round = section_named(sections, FIRST_ROUND_FINDINGS)
	const delta = section_named(sections, NEW_FINDINGS)

	return [
		...(first_round === undefined ? [] : review_lint_findings.first_round_violations(first_round)),
		...(delta === undefined ? [] : review_lint_findings.finding_violations(delta)),
	]
}

function round_two_violations(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	return [
		...heading_violations(sections, ROUND_TWO_HEADINGS),
		...verdict_violations(sections),
		...delta_violations(sections),
	]
}

// The stop condition's reply is the phrase alone: a heading beside it is a verdict it must not carry.
function mismatch_violations(sections: ReadonlyArray<ReviewSection>): ReadonlyArray<string> {
	if (sections.length === 0) return []

	return [`✖ a ${TARGET_MISMATCH} reply carries no findings and no verdict — drop the headings`]
}

// Every violation, in a fixed order; an empty array is a clean review.
function lint_review(review: string, round: number): ReadonlyArray<string> {
	const sections = review_lint_sections.parse_sections(review)

	if (markdown_shape.first_content_line(review).includes(TARGET_MISMATCH)) {
		return mismatch_violations(sections)
	}

	const shape = round === SECOND_ROUND ? round_two_violations : round_one_violations

	return [...markdown_shape.fence_violation(review, 'review'), ...shape(sections)]
}

// The violations followed by one line naming the rubric section that shapes the round's output; a
// clean review stays empty, so `ok` is still the only output of a pass.
function with_reference(violations: ReadonlyArray<string>, round: number): ReadonlyArray<string> {
	if (violations.length === 0) return violations

	const section = round === SECOND_ROUND ? ROUND_TWO_SECTION : ROUND_ONE_SECTION

	return [...violations, `→ the format: ${RUBRIC} → "${section}"`]
}

const review_lint = { lint_review, with_reference }

export { review_lint }
