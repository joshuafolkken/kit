import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'

// One gauge cell of the `⛽ usage` section (joshuafolkken/kit#6828): the window label, the percent, the
// bar with ┊ at even pace, the count and the reset time, each in a fixed column so the claude, codex
// and github rows line up — `  7d  25% ■■■■■─┊───────────── ≈412 Sat 10:00`. A label or count wider
// than its column pushes the rest of the cell right.

const { GAUGE_SHADES, bar_of } = run_board_labels
const BAR_WIDTH = 20
const PERCENT = 100
const YELLOW_PERCENT = 50
const RED_PERCENT = 90
// `▶ REST`, the widest label the first cell draws, so ▶ leaves `REST` in the `7d` column.
const LABEL_WIDTH = 6
// `≈999`, the widest count, and `5000`, GitHub's usual limit.
const COUNT_WIDTH = 4
// `Sat 10:00`, the widest reset.
const RESET_WIDTH = 9
const PACE_MARK = '┊'
const GAP = '  '
const LEVELS = ['normal', 'yellow', 'red'] as const

type Shade = (typeof GAUGE_SHADES)[(typeof LEVELS)[number]]

// `count` and `reset` may be empty; their columns are kept.
interface Cell {
	label: string
	used_percent: number
	pace: number
	count: string
	reset: string
}

// Yellow from half, red from nine tenths, a step up again once the bar is past ┊.
function level_of(used: number, pace: number): (typeof LEVELS)[number] {
	const base = Number(used >= YELLOW_PERCENT) + Number(used >= RED_PERCENT)
	const step = Number(used > pace * PERCENT)

	return LEVELS[Math.min(LEVELS.length - 1, base + step)] ?? 'red'
}

function bar_text(used: number, pace: number, shade: Shade): string {
	const filled = Math.round((Math.min(PERCENT, Math.max(0, used)) / PERCENT) * BAR_WIDTH)
	const mark = Math.min(BAR_WIDTH - 1, Math.floor(pace * BAR_WIDTH))
	const rest = BAR_WIDTH - mark - 1
	const before = bar_of(Math.min(filled, mark), mark, mark, shade)

	return `${before}${PACE_MARK}${bar_of(Math.max(0, filled - mark - 1), rest, rest, shade)}`
}

function right(text: string, width: number): string {
	return `${' '.repeat(Math.max(0, width - run_board_fit.width_of(text)))}${text}`
}

function cell_text(cell: Cell): string {
	const { label, used_percent, pace, count, reset } = cell
	const shade = GAUGE_SHADES[level_of(used_percent, pace)]

	return [
		right(label, LABEL_WIDTH),
		run_board_machine.percent_text(used_percent),
		bar_text(used_percent, pace, shade),
		right(count, COUNT_WIDTH),
		right(reset, RESET_WIDTH),
	].join(' ')
}

// The cells two spaces apart, the trailing blank of an empty reset dropped.
function row_text(cells: ReadonlyArray<Cell>): string {
	return cells
		.map((cell) => cell_text(cell))
		.join(GAP)
		.trimEnd()
}

const run_board_render_quota_cell = { cell_text, row_text }

export { run_board_render_quota_cell }
export type { Cell }
