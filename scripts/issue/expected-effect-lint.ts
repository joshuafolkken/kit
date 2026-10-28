import { markdown_section } from './markdown-section'

// joshuafolkken/kit#3909: a run-time-shortening proposal was filed and implemented on a criterion that
// never weighed how often the speed-up applies against what it costs when it does not. An Issue that
// declares that aim must therefore state its expected effect — the hit rate, the gain per hit, the loss
// per miss and where each number came from — before `issue:lint` and `issue:file` accept it. The
// declaration, the heading and the item labels are the template's, pinned by the document test.

const DECLARATION_LINE = '- 目的: 時間短縮'
const BACKGROUND_HEADING = '## 背景'
const HEADING = '## 期待効果'
const RATE_LABEL = '効く率'
const GAIN_LABEL = '1 回あたりの得'
const ITEM_LABELS: ReadonlyArray<string> = [RATE_LABEL, GAIN_LABEL, '外れたときの損', '出典']
// The numbers the backlog ranking reads off the rate and the gain (joshuafolkken/kit#5302).
const WEEK = '週'
const COUNT = /(?<![\d.])(?<count>\d+) ?回/gu
const SPAN = /(?<![\d.])(?<weeks>\d+) ?週/u
const ONE_WEEK = 1
const DURATION = /(?<![\d.])(?<amount>\d+(?:\.\d+)?) ?(?<unit>[分秒])/u
const SECONDS_UNIT = '秒'
const SECONDS_PER_MINUTE = 60
const NONE = 0
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

// The weeks a rate is counted over: its stated span ("10 in 2 weeks", "1 every 2 weeks"), else one.
function weeks_of(rate: string): number {
	const weeks = SPAN.exec(rate)?.groups?.['weeks']

	return Math.max(Number(weeks ?? ONE_WEEK), ONE_WEEK)
}

// The hits a week a rate states: its last count, so "5 of 23 a week" reads the 5 the speed-up applies to,
// over its span of weeks. `0` when the rate names no week or no count.
function weekly_hits(rate: string | undefined): number {
	if (!rate?.includes(WEEK)) return NONE
	const counts = [...rate.matchAll(COUNT)].map((match) => Number(match.groups?.['count']))

	return (counts.at(-1) ?? NONE) / weeks_of(rate)
}

// The minutes one hit saves: the first number the gain states in seconds or minutes — a range written
// with one closing unit ("3-6 min") reads its upper bound. `0` when it states none.
function minutes_per_hit(gain = ''): number {
	const groups = DURATION.exec(gain)?.groups
	if (groups === undefined) return NONE
	const amount = Number(groups['amount'])

	return groups['unit'] === SECONDS_UNIT ? amount / SECONDS_PER_MINUTE : amount
}

// The minutes a week the declared speed-up saves — hits a week times the gain per hit — on the same
// minute scale as `issue_priority.lost_minutes`. `0` when the rate or the gain is not a number.
function weekly_minutes(body = ''): number {
	return weekly_hits(value_of(body, RATE_LABEL)) * minutes_per_hit(value_of(body, GAIN_LABEL))
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
	weekly_minutes,
}

export { expected_effect_lint }
