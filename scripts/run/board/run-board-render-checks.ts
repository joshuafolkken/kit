import { styleText } from 'node:util'
import type { CodeRabbitState, PrChecks } from '#scripts/run/event/run-event-checks'
import type { TextColor } from './run-board-labels'

// A followup row's pull request (joshuafolkken/kit#3770): its number, the CI checks counted by how
// they stand and CodeRabbit's state — `PR 3765  ✓ 6  ⏳ 2  🐰 ⏳`. A count of none is left out, a
// failure is red and a rate limit yellow, so what needs a person stands out of a row of green.

const GAP = '  '
const CHECK_ICONS = { pass: '✓', pending: '⏳', fail: '✗' } as const
const CODERABBIT_ICON = '🐰'
const CODERABBIT_MARKS: Readonly<Record<CodeRabbitState, string | undefined>> = {
	running: CHECK_ICONS.pending,
	done: CHECK_ICONS.pass,
	'rate-limited': '⛔',
	failed: CHECK_ICONS.fail,
	none: undefined,
}
const CODERABBIT_COLORS: Readonly<Partial<Record<CodeRabbitState, TextColor>>> = {
	'rate-limited': 'yellow',
	failed: 'red',
}
// Each mark the legend can name, in its order, with its word.
const CHECK_WORDS: ReadonlyArray<readonly [string, string]> = [
	[CHECK_ICONS.pass, 'passed'],
	[CHECK_ICONS.pending, 'pending'],
	[CHECK_ICONS.fail, 'failed'],
]
const RATE_LIMITED_MARK = CODERABBIT_MARKS['rate-limited'] ?? ''

function tinted(text: string, color: TextColor | undefined): string {
	return color === undefined ? text : styleText(color, text)
}

function count_part(icon: string, count: number, color?: TextColor): Array<string> {
	return count === 0 ? [] : [tinted(`${icon} ${String(count)}`, color)]
}

function coderabbit_part(state: CodeRabbitState): Array<string> {
	const mark = CODERABBIT_MARKS[state]

	return mark === undefined ? [] : [tinted(`${CODERABBIT_ICON} ${mark}`, CODERABBIT_COLORS[state])]
}

function checks_part(checks: PrChecks): string {
	return [
		`PR ${String(checks.pr)}`,
		...count_part(CHECK_ICONS.pass, checks.pass),
		...count_part(CHECK_ICONS.pending, checks.pending),
		...count_part(CHECK_ICONS.fail, checks.fail, 'red'),
		...coderabbit_part(checks.coderabbit),
	].join(GAP)
}

// The marks one row's part draws: each count it leaves in and CodeRabbit's mark.
function marks_of(checks: PrChecks): Array<string> {
	const counts: ReadonlyArray<readonly [string, number]> = [
		[CHECK_ICONS.pass, checks.pass],
		[CHECK_ICONS.pending, checks.pending],
		[CHECK_ICONS.fail, checks.fail],
	]
	const drawn = counts.filter(([, count]) => count > 0).map(([icon]) => icon)

	return [...drawn, CODERABBIT_MARKS[checks.coderabbit] ?? '']
}

function coderabbit_legend(drawn: ReadonlyArray<PrChecks>): Array<string> {
	const states = new Set(drawn.map((checks) => checks.coderabbit))
	const limited = states.has('rate-limited') ? ` (${RATE_LIMITED_MARK} rate-limited)` : ''

	states.delete('none')

	return states.size === 0 ? [] : [`${CODERABBIT_ICON} CodeRabbit${limited}`]
}

// What the legend says of the parts the rows draw (`drawn`): only the marks some part draws.
function legend_of(drawn: ReadonlyArray<PrChecks>): Array<string> {
	const marks = new Set(drawn.flatMap((checks) => marks_of(checks)))
	const shown = CHECK_WORDS.filter(([icon]) => marks.has(icon))
	const icons = shown.map(([icon]) => icon).join(' ')
	const words = shown.map(([, word]) => word).join(' · ')
	const checks = shown.length === 0 ? [] : [`${icons} checks ${words}`]

	return [...checks, ...coderabbit_legend(drawn)]
}

const run_board_render_checks = { checks_part, legend_of }

export { run_board_render_checks }
