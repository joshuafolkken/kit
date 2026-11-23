import { issue_body_keys } from './issue-body-keys'
import { markdown_section } from './markdown-section'
import { session_cite } from './session-cite'

// joshuafolkken/kit#8799: rework of delivered work that fell short of its Issue or the owner's
// expectation — quality, speed, cost or look — is a defect. A non-defect body that cites a merged
// pull request or a closed Issue in its summary or background, with no new goal set after that
// delivery, is such rework filed as an enhancement. The one judgement `issue:file` refuses on and
// `issue:rework-candidates` lists by; the caller reads which cited numbers are delivered
// (`rework-reference-state.ts`) and passes them in.

const CITING_HEADINGS = [issue_body_keys.heading('summary'), issue_body_keys.heading('background')]
const BACKGROUND_HEADING = issue_body_keys.heading('background')
const NON_BUG_DECLARATION = issue_body_keys.line('kind', 'non_bug')
const NEW_GOAL_PREFIX = issue_body_keys.prefix('new_goal')
// An order declaration points at a sibling to run after, not at work the Issue reworks.
const ORDER_PREFIX = issue_body_keys.prefix('order')
// `parent: #<N>` names the epic the Issue sits in.
const PARENT_LINE = /^-\s*parent:/iu
// A same-repository `#<N>`: not `owner/repo#<N>`, an HTML entity `&#<N>` or a `##` heading.
const REFERENCE = /(?<![\w/&#])#(?<number>\d+)\b/gu

function background_of(body: string): string {
	return markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
}

function has_new_goal(body: string): boolean {
	return markdown_section
		.unfenced_lines(body)
		.some((line) => line.trim().startsWith(NEW_GOAL_PREFIX) && line.trim() !== NEW_GOAL_PREFIX)
}

// A non-defect declaration with no new goal: the body whose citations are worth reading.
function is_unexplained_non_defect(body: string): boolean {
	return (
		markdown_section.has_unfenced_line(background_of(body), NON_BUG_DECLARATION) &&
		!has_new_goal(body)
	)
}

function is_citing(line: string): boolean {
	const text = line.trim()

	return !PARENT_LINE.test(text) && !text.startsWith(ORDER_PREFIX)
}

function numbers_in(line: string): ReadonlyArray<number> {
	return [...line.matchAll(REFERENCE)].map((match) => Number(match.groups?.['number']))
}

function section_text(body: string, heading: string): ReadonlyArray<string> {
	return markdown_section.unfenced_lines(markdown_section.section_lines(body, heading).join('\n'))
}

// Every `#<N>` the summary and background cite outside fences, parent and order lines, once each.
function references(body: string): ReadonlyArray<number> {
	const lines = CITING_HEADINGS.flatMap((heading) => section_text(body, heading))

	return [...new Set(lines.filter((line) => is_citing(line)).flatMap((line) => numbers_in(line)))]
}

// The numbers whose state decides the judgement: `[]` unless the body is an unexplained non-defect.
function cited(body: string): ReadonlyArray<number> {
	return is_unexplained_non_defect(body) ? references(body) : []
}

// The delivered work `body` reworks while filed as a non-defect; `[]` when it is not such rework.
function reworked(body: string, delivered: ReadonlySet<number>): ReadonlyArray<number> {
	return cited(body).filter((number) => delivered.has(number))
}

function message(numbers: ReadonlyArray<number>): string {
	const listed = numbers.map((number) => session_cite.issue(number)).join(', ')

	return `rework filed as a non-defect: the body cites delivered work (${listed}) and declares \`${NON_BUG_DECLARATION}\` with no new goal. Work that fell short of its Issue or the owner's expectation (quality, speed, cost, look) is a defect — write \`${issue_body_keys.line('kind', 'bug')}\` and \`${issue_body_keys.prefix('origin')} #<PR>\`; a goal set after that delivery — add \`${NEW_GOAL_PREFIX} <when it was set, and what it is>\` (issue-template.md → the classification rules).`
}

function problem(body: string, delivered: ReadonlySet<number>): string | undefined {
	const numbers = reworked(body, delivered)

	return numbers.length === 0 ? undefined : message(numbers)
}

const rework_classification = { cited, problem, references, reworked }

export { rework_classification }
