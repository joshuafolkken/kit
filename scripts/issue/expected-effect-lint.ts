import { markdown_section } from './markdown-section'

// joshuafolkken/kit#3909: a run-time-shortening proposal was filed and implemented on a criterion that
// never weighed how often the speed-up applies against what it costs when it does not. An Issue that
// declares that aim must therefore state its expected effect — the hit rate, the gain per hit, the loss
// per miss and where each number came from — before `issue:lint` and `issue:file` accept it. The
// declaration, the heading and the item labels are the template's, pinned by the document test.

const DECLARATION_LINE = '- 目的: 時間短縮'
const BACKGROUND_HEADING = '## 背景'
const HEADING = '## 期待効果'
const ITEM_LABELS: ReadonlyArray<string> = ['効く率', '1 回あたりの得', '外れたときの損', '出典']
// A template placeholder value — the `<...>` guidance a filed Issue replaces. It is not an estimate, but a
// value that only opens with `<` (an upper bound such as `<1 min`) is one, so the placeholder must close with `>` too.
const PLACEHOLDER = /^<.*>$/u

// Whether the body declares a run-time-shortening aim under its background heading.
function is_target(body: string): boolean {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')

	return markdown_section.has_unfenced_line(background, DECLARATION_LINE)
}

function item_value(line: string, label: string): string | undefined {
	const prefix = `- ${label}:`

	if (!line.startsWith(prefix)) return undefined

	return line.slice(prefix.length).trim()
}

function is_stated(value: string | undefined): value is string {
	return value !== undefined && value.length > 0 && !PLACEHOLDER.test(value)
}

function stated_value(lines: ReadonlyArray<string>, label: string): string | undefined {
	return lines.map((line) => item_value(line.trim(), label)).find((value) => is_stated(value))
}

function effect_lines(body: string): ReadonlyArray<string> {
	const section = markdown_section.section_lines(body, HEADING).join('\n')

	return markdown_section.unfenced_lines(section)
}

// The value the body's expected-effect section states for one item, or undefined when it states none.
function value_of(body: string, label: string): string | undefined {
	return stated_value(effect_lines(body), label)
}

// Every expected-effect problem a body has, or an empty array. A body without the declaration has none.
function problems(body: string): ReadonlyArray<string> {
	if (!is_target(body)) return []
	if (!markdown_section.has_line(body, HEADING)) return [`missing heading: ${HEADING}`]
	const lines = effect_lines(body)

	return ITEM_LABELS.filter((label) => stated_value(lines, label) === undefined).map(
		(label) => `missing expected-effect item: - ${label}: <value>`,
	)
}

const expected_effect_lint = {
	DECLARATION_LINE,
	HEADING,
	ITEM_LABELS,
	is_target,
	problems,
	value_of,
}

export { expected_effect_lint }
