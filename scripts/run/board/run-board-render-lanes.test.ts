import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type PlanLine } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lanes, type LaneCells } from './run-board-render-lanes'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_row_key } from './run-board-row-key'
import { run_board_seat } from './run-board-seat'
import type { UsageFigure } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// joshuafolkken/kit#4171, #4292: each lane row draws its CPU, MEM and CMPRS cells after its lead and
// before its number, under a rule whose labels stand over them.

const { COLUMN_LABELS, LANES_LABEL, lane_cells_of, lanes_section, number_text } =
	run_board_render_lanes
const { ELAPSED_START, USAGE_START } = run_board_render_lead
const { GB, board_usage, header } = run_board_render_fixture
const { GAUGE_SHADES, bar_of } = run_board_labels
const LANE = 42
const SCREEN_GAUGE = 5
const FIGURE: UsageFigure = { cpu_cores: 1.8, memory_bytes: 0.7 * GB, compressed_bytes: 0.6 * GB }
const LINE: PlanLine = { text: '  1', row: { stage: 'running', at_ms: 1 } }
const CELLS: LaneCells = {
	usages: new Map([[LANE, FIGURE]]),
	scale: { cores: 10, total_bytes: 16 * GB },
	limits: run_board_usage_text.lane_limits(1),
	gauge: 0,
	number_width: 8,
}
const LONG_LANE = 123_456_789

function row_of(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: 'Title', kind: undefined, state, status: undefined, waits: [] }
}

// How many columns the rule draws before `mark`.
function column_of(rule: string, mark: string): number {
	return run_board_fit.width_of(rule.slice(0, rule.indexOf(mark)))
}

function plain(text: string): string {
	return text
}

function bracketed(text: string): string {
	return `<${text}>`
}

describe('run_board_render_lanes.number_text', () => {
	it('pads the number and draws the running row its figures, each right-aligned in its column', () => {
		expect(number_text(row_of(LANE, 'running'), CELLS, plain)).toBe(
			'    18.0      0.7        0.6 42      ',
		)
	})

	it('draws blanks of the same width before the number for a row that is not running', () => {
		const running = number_text(row_of(LANE, 'running'), CELLS, plain)
		const waiting = number_text(row_of(LANE, 'waiting'), CELLS, plain)

		expect(waiting).toBe(`${' '.repeat(running.length - '42      '.length)}42      `)
	})

	it('draws the linked number alone where no cells are drawn', () => {
		expect(number_text(row_of(LANE, 'running'), undefined, bracketed)).toBe('<42>')
	})
})

// joshuafolkken/kit#4283: a lane at 59.5% of the machine's CPU drew green against the machine's 70%.
describe('run_board_render_lanes.number_text lane share colors', () => {
	const BUSY: UsageFigure = { cpu_cores: 5.95, memory_bytes: 0.2 * GB, compressed_bytes: 0 }

	function shade_of_busy(running: ReadonlyArray<BoardRow>): string {
		const board = header({ spinner: '⠋', usages: board_usage(new Map([[LANE, BUSY]])) })
		const cells = lane_cells_of(board, running)

		if (cells === undefined) return ''

		return number_text(row_of(LANE, 'running'), { ...cells, scale: CELLS.scale }, plain)
	}

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('shades the busy lane yellow with one lane running and red with two', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const lane = row_of(LANE, 'running')

		expect(shade_of_busy([lane])).toContain(bar_of(5.95, 7, SCREEN_GAUGE, GAUGE_SHADES.yellow))
		expect(shade_of_busy([lane, row_of(7, 'running')])).toContain(
			bar_of(5.95, 3.5, SCREEN_GAUGE, GAUGE_SHADES.red),
		)
	})
})

describe('run_board_render_lanes.lanes_section', () => {
	// joshuafolkken/kit#8514: the lanes rule's tail carries the run's tallies, so it is drawn without a row.
	it('draws the lanes rule with its tallies without lines', () => {
		expect(lanes_section([], CELLS, header())).toStrictEqual([
			expect.objectContaining({ label: LANES_LABEL, lines: [], tail: '✅ 0/0  🔄 0  💤 0' }),
		])
	})

	it('heads the lines with a rule with ⏰ over the elapsed column where no cells are drawn', () => {
		const [section] = lanes_section([LINE], undefined, header())
		const rule = section?.head[1] ?? ''

		expect(section).toMatchObject({ label: LANES_LABEL, key: 'lanes', lines: [LINE] })
		expect(section?.head[0]).toBe('')
		expect(column_of(rule, '⏰')).toBe(ELAPSED_START)
		expect(rule).not.toContain('CPU')
	})

	it('heads the lines with a rule whose labels stand over the cells', () => {
		const [section] = lanes_section([LINE], CELLS, header())
		const rule = run_board_label_pair.bare(section?.head[1] ?? '')

		expect(rule.startsWith('── 🧵 lanes ')).toBe(true)
		expect(column_of(rule, '💪 CPU')).toBe(USAGE_START)
		expect(column_of(rule, '⏰')).toBe(ELAPSED_START)
	})

	// joshuafolkken/kit#7523: a single run runs in the root checkout, not in a lane.
	// joshuafolkken/kit#8993: the heading is `🏠 runs` whatever the command; the row names it.
	it.each(['fullrun', 'halfrun'])('heads a single %s row with 🏠 runs', (run_name) => {
		const [section] = lanes_section([LINE], CELLS, header({ run_name }))
		const rule = run_board_label_pair.bare(section?.head[1] ?? '')

		expect(rule.startsWith('── 🏠 runs ')).toBe(true)
		expect(rule).not.toContain(run_board_label_pair.bare(LANES_LABEL))
		expect(section?.lines).toStrictEqual([LINE])
		expect(column_of(rule, '💪 CPU')).toBe(USAGE_START)
		expect(column_of(rule, '⏰')).toBe(ELAPSED_START)
	})

	// joshuafolkken/kit#4223: a text-default icon is counted one column wide but drawn two.
	it('marks the rule and its columns with icons two columns wide', () => {
		const icons = [LANES_LABEL, ...COLUMN_LABELS].map((label) => label.split(' ', 1)[0] ?? '')

		expect(icons.map((icon) => run_board_fit.width_of(icon))).toStrictEqual([2, 2, 2, 2])
	})
})

describe('run_board_render_lanes.COLUMN_LABELS', () => {
	it('marks each label as an icon beside its text, drawn bare without a theme', () => {
		const bare = COLUMN_LABELS.map((label) => run_board_label_pair.bare(label))

		expect(COLUMN_LABELS.every((label) => label.includes(run_board_label_pair.MARK))).toBe(true)
		expect(bare.map((label) => label.split(' ').slice(1).join(' '))).toStrictEqual([
			'CPU',
			'MEM',
			'CMPRS',
		])
	})
})

function without_keys(texts: ReadonlyArray<string>): Array<string> {
	return texts.map((text) => run_board_row_key.without_key(text))
}

// joshuafolkken/kit#8116: a themed frame keys each empty seat's reason after its lead, by the uncut words.
describe('run_board_render_lanes.lanes_section seat keys', () => {
	const SEATED = { lane_limit: 2, occupied_count: 0, seats: {} }
	const SEAT_KEY = `seat:${run_board_seat.NO_CANDIDATE}`
	const NARROW = 20

	function seat_texts(keyed: boolean, columns?: number): Array<string> {
		const [section] = lanes_section([], undefined, header({ ...SEATED, is_keyed: keyed }), columns)

		return (section?.lines ?? []).filter((line) => line.is_seat === true).map((line) => line.text)
	}

	it('keys each seat line after its lead only where the frame is keyed', () => {
		const splits = seat_texts(true).map((text) => run_board_row_key.split_key(text))

		expect(splits.map((split) => split.key)).toStrictEqual([SEAT_KEY, SEAT_KEY])
		expect(splits.every((split) => split.prefix.endsWith('💺 '))).toBe(true)
		expect(seat_texts(false).map((text) => run_board_row_key.split_key(text).key)).toStrictEqual([
			undefined,
			undefined,
		])
	})

	it('draws the same seat lines with the key taken out, cut at the pane’s edge or not', () => {
		expect(without_keys(seat_texts(true))).toStrictEqual(seat_texts(false))
		expect(without_keys(seat_texts(true, NARROW))).toStrictEqual(seat_texts(false, NARROW))
		expect(run_board_row_key.split_key(seat_texts(true, NARROW)[0] ?? '').key).toBe(SEAT_KEY)
	})
})

describe('run_board_render_lanes.lane_cells_of', () => {
	it('draws no cells where the frame read no usage', () => {
		expect(lane_cells_of(header(), [row_of(LANE, 'running')])).toBeUndefined()
	})

	it('draws figures alone where the frame draws no spinner, the numbers padded to the widest', () => {
		const board = header({ usages: board_usage(new Map()) })

		expect(lane_cells_of(board, [row_of(LANE, 'running'), row_of(7, 'waiting')])).toMatchObject({
			gauge: 0,
			number_width: String(LANE).length,
		})
	})

	it('pads the numbers to the widest where it is wider than the rule needs', () => {
		const board = header({ usages: board_usage(new Map()) })

		expect(lane_cells_of(board, [row_of(LONG_LANE, 'running')])?.number_width).toBe(
			String(LONG_LANE).length,
		)
	})

	it('counts the live rows a lane’s share is divided by', () => {
		const board = header({ usages: board_usage(new Map()) })
		const rows = [row_of(LANE, 'running'), row_of(7, 'running'), row_of(8, 'waiting')]

		expect(lane_cells_of(board, rows)?.limits).toStrictEqual(run_board_usage_text.lane_limits(2))
	})

	it('draws gauges on a terminal', () => {
		const board = header({ spinner: '⠋', usages: board_usage(new Map()) })

		expect(lane_cells_of(board, [])?.gauge).toBe(SCREEN_GAUGE)
	})
})
