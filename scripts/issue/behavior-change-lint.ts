import { firing_point } from '#scripts/rules/firing-point'
import { baseline_measure } from './baseline-measure'
import { markdown_section } from './markdown-section'

// A behavior-change Issue owes two headings the ordinary template does not — a firing-point heading
// (the tool call the rule breaks on) and a baseline heading (a re-runnable measurement). This checks
// them, but only for an Issue that declares itself one, and never asks the model to judge whether it
// is (joshuafolkken/kit#2212). The declaration, the headings and the grammars are the template's,
// pinned by the document test.

// The body declares itself a behavior-change Issue with this exact line under its opening heading.
// Read from the declaration, never inferred, so a code-only Issue is never held to the two headings.
const DECLARATION_LINE = '- 種別: 振る舞い変更'
const FIRING_POINT_HEADING = '## 発火点'
const BASELINE_HEADING = '## ベースライン'
const REQUIRED_HEADINGS: ReadonlyArray<string> = [FIRING_POINT_HEADING, BASELINE_HEADING]

// A template placeholder line — the `<...>` guidance a filed Issue replaces. It is not a firing point.
const PLACEHOLDER_PREFIX = '<'
const BACKTICKED = /`([^`]+)`/u
const WHITESPACE = /\s+/u
// A leading Markdown bullet marker (`- ` / `* `), stripped before the firing-point token is read so a
// bulleted line (`- Bash`) yields `Bash` rather than the dash.
const BULLET_MARKER = /^[-*]\s+/u

// Whether the body declares itself a behavior-change Issue.
function is_target(body: string): boolean {
	return markdown_section.has_line(body, DECLARATION_LINE)
}

// The required headings a behavior-change body lacks, in template order.
function missing_headings(body: string): ReadonlyArray<string> {
	return REQUIRED_HEADINGS.filter((heading) => !markdown_section.has_line(body, heading))
}

function is_content(line: string): boolean {
	return line.length > 0 && !line.startsWith(PLACEHOLDER_PREFIX)
}

function first_content_line(lines: ReadonlyArray<string>): string | undefined {
	return lines.map((line) => line.trim()).find((line) => is_content(line))
}

// The tool call name written under the firing-point heading, or undefined when the section names none.
// A backticked token wins (`` `Bash` ``); otherwise a leading bullet marker is stripped and the first
// whitespace-delimited word is taken, so both `Bash` and `- Bash` yield `Bash`.
function firing_point_name(body: string): string | undefined {
	const line = first_content_line(markdown_section.section_lines(body, FIRING_POINT_HEADING))

	if (line === undefined) return undefined

	return BACKTICKED.exec(line)?.[1] ?? line.replace(BULLET_MARKER, '').split(WHITESPACE, 1)[0]
}

function firing_point_problem(body: string): string | undefined {
	const name = firing_point_name(body)

	if (name === undefined) return undefined

	if (firing_point.classify(name) === 'not-delivered') {
		return `firing point \`${name}\` is a real tool call, but no hook can deliver a rule on it`
	}

	if (firing_point.classify(name) === 'unknown') {
		return `firing point \`${name}\` is not on the delivery table (not a recognized tool call)`
	}

	return undefined
}

function baseline_problem(body: string): string | undefined {
	if (!markdown_section.has_line(body, BASELINE_HEADING)) return undefined

	if (baseline_measure.has_command_value(body)) return undefined

	return 'baseline must be written as `command → value`, not prose (it has to be re-runnable)'
}

function heading_problems(body: string): ReadonlyArray<string> {
	return missing_headings(body).map((heading) => `missing heading: ${heading}`)
}

// Every behavior-change problem a body has, or an empty array. A body that does not declare itself a
// behavior-change Issue has none — the two headings are not required of it.
function problems(body: string): ReadonlyArray<string> {
	if (!is_target(body)) return []

	return [...heading_problems(body), firing_point_problem(body), baseline_problem(body)].filter(
		(problem): problem is string => problem !== undefined,
	)
}

const behavior_change_lint = {
	is_target,
	missing_headings,
	firing_point_name,
	problems,
	REQUIRED_HEADINGS,
	DECLARATION_LINE,
}

export { behavior_change_lint }
