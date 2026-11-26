import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import type { PinnedIssue } from './run-board-pinned-graphql'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#8247: every rule keeps one width for a terminal width — with no lane row, any number
// of them, short titles or long — and never runs past the pane, themed or not.

const { EMPTY_LAYOUT, NOW, board_usage, header, note } = run_board_render_fixture
const { width_of } = run_board_fit
const TALL = 200
const COLUMNS = 160
// Narrower than a lane row's full title, wide enough for every rule's own label and column heads.
const NARROW = 60
// joshuafolkken/kit#8663: narrower than the rule width (about 118), and wider than it but narrower than
// a whole lane row with its tail.
const UNDER_RULE = 100
const OVER_RULE = 122
// The closed pin's row is the panel's widest.
const CLOSED_PIN = 8591
const PINNED: ReadonlyArray<PinnedIssue> = [
	{ number: CLOSED_PIN, is_closed: true, closed_ms: NOW },
	{ number: 8353, is_closed: false, closed_ms: undefined },
]
const FIRST_LANE = 8240
const LANE_COUNT = 4
const SHORT_TITLE = 'Short'
const LONG_TITLE = 'A lane title far longer than the title column the board cuts every title to'
const RULE_MARKS = ['── ', '▾ ', '▸ ']

function lane(number: number, title: string): BoardRow {
	return {
		number,
		title,
		kind: undefined,
		state: 'running',
		status: { state: 'running', started_ms: NOW, phase_ms: NOW, track: ['implement'] },
		waits: [],
	}
}

function lanes(count: number, title = SHORT_TITLE): Array<BoardRow> {
	return Array.from({ length: count }, (_, index) => lane(FIRST_LANE + index, title))
}

// The watch panel's pins, and a frame drawn before the first usage lands.
interface Extra {
	pinned?: ReadonlyArray<PinnedIssue>
	is_unsampled?: boolean
}

function rendered(
	active: Array<BoardRow>,
	is_themed: boolean,
	columns: number,
	extra: Extra = {},
): Array<string> {
	const board = header({
		layout: { ...EMPTY_LAYOUT, active, unreached: [lane(FIRST_LANE - 1, SHORT_TITLE)] },
		occupied_count: active.length,
		lane_limit: LANE_COUNT,
		usages: extra.is_unsampled === true ? undefined : board_usage(new Map()),
		theme: is_themed ? 'wopr' : undefined,
	})
	const lines = run_board_render.render({
		header: board,
		notes: [note(NOW, 'seen')],
		size: { rows: TALL, columns },
		folded: new Set(),
		pinned: extra.pinned ?? [],
	})

	return lines.map((line) => stripVTControlCharacters(line))
}

function rules_of(lines: ReadonlyArray<string>): Array<number> {
	return lines
		.filter((line) => RULE_MARKS.some((mark) => line.startsWith(mark)))
		.map((line) => width_of(line))
}

function rule_widths(
	active: Array<BoardRow>,
	is_themed: boolean,
	columns = COLUMNS,
): Array<number> {
	return rules_of(rendered(active, is_themed, columns))
}

// The column a lane row's cut title ends in, its ellipsis included.
function title_end(line: string): number {
	return width_of(line.slice(0, line.indexOf('…') + 1))
}

describe.each([false, true])('run_board_render rule width (themed: %s)', (is_themed) => {
	it('draws every rule at one width with no lane row and with four', () => {
		const none = rule_widths([], is_themed)
		const four = rule_widths(lanes(LANE_COUNT), is_themed)

		expect(none.length).toBeGreaterThan(1)
		expect(new Set(none)).toStrictEqual(new Set([Math.max(...four)]))
		expect(new Set(four)).toStrictEqual(new Set(none))
	})

	it('draws the rules at one width for short titles and titles past the title column', () => {
		const short = rule_widths(lanes(1, SHORT_TITLE), is_themed)
		const long = rule_widths(lanes(1, LONG_TITLE), is_themed)

		expect(new Set(short)).toStrictEqual(new Set(long))
		expect(new Set(short).size).toBe(1)
	})

	it.each([12, 10_001])('ends every rule where lane #%i’s full title ends', (number) => {
		const active = [lane(number, LONG_TITLE)]
		const lines = rendered(active, is_themed, COLUMNS)
		const row = lines.find((line) => line.includes(` ${String(number)} `)) ?? ''
		const ends = new Set([title_end(row)])

		expect(new Set(rules_of(lines))).toStrictEqual(ends)
	})

	// joshuafolkken/kit#8957: a frame drawn before the first usage lands draws no cells, yet its rules
	// already run as wide as they will once the usage lands.
	it('draws every rule at one width before the usage lands and after', () => {
		const before = rules_of(rendered(lanes(1), is_themed, COLUMNS, { is_unsampled: true }))
		const after = rule_widths(lanes(1), is_themed)

		expect(new Set(before)).toStrictEqual(new Set(after))
		expect(new Set(after).size).toBe(1)
	})

	it('ends every rule at the pane edge where the pane is narrower than a full title', () => {
		const widths = [
			...rule_widths([], is_themed, NARROW),
			...rule_widths(lanes(1), is_themed, NARROW),
		]

		expect(new Set(widths)).toStrictEqual(new Set([NARROW]))
	})
})

describe.each([false, true])(
	'run_board_render rule width between panes (themed: %s)',
	(is_themed) => {
		it('ends every rule at the pane edge where the pane is narrower than the rule width', () => {
			const widths = [
				...rule_widths([], is_themed, UNDER_RULE),
				...rule_widths(lanes(1), is_themed, UNDER_RULE),
			]

			expect(new Set(widths)).toStrictEqual(new Set([UNDER_RULE]))
		})

		it('keeps the rule width where the pane is wider than it but narrower than a whole lane row', () => {
			const wide = rule_widths([], is_themed)
			const over = rule_widths(lanes(1), is_themed, OVER_RULE)

			expect(Math.max(...wide)).toBeLessThan(OVER_RULE)
			expect(new Set(over)).toStrictEqual(new Set(wide))
		})

		it('ends the watch panel’s widest pin at the pane edge where the pane is narrower than the rule width', () => {
			const lines = rendered([], is_themed, UNDER_RULE, { pinned: PINNED })
			const pin = lines.find((line) => line.includes(`✅ ${String(CLOSED_PIN)}`)) ?? ''

			expect(width_of(pin)).toBe(UNDER_RULE)
		})
	},
)
