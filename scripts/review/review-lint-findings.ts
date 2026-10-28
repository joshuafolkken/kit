import { review_lint_sections, type ReviewSection } from './review-lint-sections'

// The finding-line checks of `review:lint` (`prompts/review-rubric.md` → "Review output format"): every
// finding cites `file_path:line_number` and a severity, and a `low` carries its
// `no failure scenario — <what you tried>` line. A round-2 first-round line cites the severity it
// had (`(was high)`) and its resolution instead.

interface ItemRule {
	readonly holds: (block: string) => boolean
	readonly message: string
}

const FILE_LINE = /`[^`\s]+:\d+(?:-\d+)?`/u
const SEVERITY = /\((?:high|medium|low)\)/u
const LOW_MARKER = '(low)'
const NO_FAILURE_SCENARIO = 'no failure scenario —'
const PRIOR_SEVERITY = /\(was (?:high|medium|low)\)/u
const RESOLUTION = /\bresolved\b/u
// An item that is a trace or a `No issues` proof is the category's verdict, not a finding.
const VERDICT_ITEM = /^(?:Traced |No issues)/u

function cites_file_line(block: string): boolean {
	return FILE_LINE.test(block)
}

function states_severity(block: string): boolean {
	return SEVERITY.test(block)
}

function low_has_scenario_line(block: string): boolean {
	return !block.includes(LOW_MARKER) || block.includes(NO_FAILURE_SCENARIO)
}

function states_prior_severity(block: string): boolean {
	return PRIOR_SEVERITY.test(block)
}

function states_resolution(block: string): boolean {
	return RESOLUTION.test(block)
}

const FINDING_RULES: ReadonlyArray<ItemRule> = [
	{ holds: cites_file_line, message: 'finding without a `file:line` citation' },
	{ holds: states_severity, message: 'finding without a severity (high|medium|low)' },
	{
		holds: low_has_scenario_line,
		message: `low finding without "${NO_FAILURE_SCENARIO} <what you tried>"`,
	},
]

const FIRST_ROUND_RULES: ReadonlyArray<ItemRule> = [
	{ holds: cites_file_line, message: 'first-round line without a `file:line` citation' },
	{ holds: states_prior_severity, message: 'first-round line without "(was <severity>)"' },
	{ holds: states_resolution, message: 'first-round line without "resolved" or "not resolved"' },
]

function first_line(block: string): string {
	return block.split('\n', 1)[0]?.trim() ?? ''
}

function rule_violations(
	block: string,
	heading: string,
	rules: ReadonlyArray<ItemRule>,
): ReadonlyArray<string> {
	const where = `under ### ${heading}: ${first_line(block)}`

	return rules.filter((rule) => !rule.holds(block)).map((rule) => `✖ ${rule.message} ${where}`)
}

function finding_blocks(section: ReviewSection): ReadonlyArray<string> {
	return review_lint_sections
		.item_blocks(section.lines)
		.filter((block) => !VERDICT_ITEM.test(review_lint_sections.item_text(block)))
}

function finding_violations(section: ReviewSection): ReadonlyArray<string> {
	return finding_blocks(section).flatMap((block) =>
		rule_violations(block, section.heading, FINDING_RULES),
	)
}

function first_round_violations(section: ReviewSection): ReadonlyArray<string> {
	return review_lint_sections
		.item_blocks(section.lines)
		.flatMap((block) => rule_violations(block, section.heading, FIRST_ROUND_RULES))
}

const review_lint_findings = { finding_blocks, finding_violations, first_round_violations }

export { review_lint_findings }
