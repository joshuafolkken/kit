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
// What the legend says of the part, once some row draws it.
const LEGEND = [
	`${CHECK_ICONS.pass} ${CHECK_ICONS.pending} ${CHECK_ICONS.fail} checks passed · pending · failed`,
	`${CODERABBIT_ICON} CodeRabbit (${CODERABBIT_MARKS['rate-limited'] ?? ''} rate-limited)`,
]

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

const run_board_render_checks = { LEGEND, checks_part }

export { run_board_render_checks }
