import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import type { TerminalSize } from './run-board-fit'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { LayoutView } from './run-board-theme-layout'
import type { KeyedLine } from './run-board-type-rows'

// A live board of any size for the themes' stress test (joshuafolkken/kit#8917): the confirmed demo's
// board in outline — the header, the THROUGHPUT and usage rows the lamp panel runs right of, the lanes
// and the rows under them — at a terminal size, a rule length (the board's edge), a panel column, a
// count of lane rows and of panel rows, with the places kit lays out on it.

const ESC = '\u{1B}'
const BODY = `${ESC}[38;2;0;215;60m`
const RULE = `${ESC}[38;2;0;100;22m`
// The header's notice and now line start at these columns, the pins are its last thirteen.
const NOTICE_X = 45
const PROGRESS_X = 48
const PINS = 13
const PINS_GAP = 3
// The panel's first lamp row (1-based) — the `24h` row — and the rows above the usage section's: the
// `24h` and `7d` rows, the blank under them and the usage rule.
const FIRST_LAMP_ROW = 6
const ABOVE_USAGE = 4
const LAMPS_PER_ROW = 2
// Where a lane row's key starts, its spinner, and the header's clocks' colons (1-based).
const LANE_PREFIX = 5
const LANE_SPIN = 3
const COLON_COLUMN = 29
const SIGN_SPIN = 18
const NOTICE_ROW = 2
const HEADER_ROWS = 3
const ISSUES = ['8899', '8897', '8826']
const LINK_BASE = 'https://github.com/joshuafolkken/kit/issues/'

// A board: the terminal's columns and rows, the rules' end, the panel's first column (0-based), the
// lane rows and the panel's rows.
interface StressBoard {
	columns: number
	rows: number
	edge: number
	px: number
	lanes: number
	panel_rows: number
	// joshuafolkken/kit#8917: a live board's shape — its rules led by the fold marker (`V --`, a
	// folded one `> --` with its rows gone), and a stopped run that turns no spinner.
	shape?: LiveShape
}

interface LiveShape {
	folded: ReadonlyArray<string>
	is_stopped: boolean
	// The lanes' issue numbers: real lanes' by default, demo mode's sample rows' where it draws them.
	issues?: ReadonlyArray<string>
}

// Issue numbers no demo sample row has, so a live shape's lanes are real ones.
const LIVE_ISSUES = ['8901', '8902', '8903']

function issues_of(board: StressBoard): ReadonlyArray<string> {
	if (board.shape === undefined) return ISSUES

	return board.shape.issues ?? LIVE_ISSUES
}

interface Line {
	text: string
	is_rule: boolean
}

function cut(text: string, width: number): string {
	return run_board_theme_host_grid.code_points(text).slice(0, Math.max(0, width)).join('')
}

function body(text: string): Line {
	return { text, is_rule: false }
}

// A rule's lead: the demo's `-- --`, a live board's fold marker before its `--`.
function lead_of(label: string, shape: LiveShape | undefined): string {
	if (shape === undefined) return '-- -- '

	return shape.folded.some((name) => label.startsWith(name)) ? '> -- ' : 'V -- '
}

function rule(label: string, board: StressBoard): Line {
	const tail = ' TRACE ■----'
	const lead = lead_of(label, board.shape)

	return {
		text: `${lead}${label} `.padEnd(board.edge - tail.length, '-') + tail,
		is_rule: true,
	}
}

function is_folded(board: StressBoard, name: string): boolean {
	return board.shape?.folded.includes(name) ?? false
}

// A section's rule, and its rows unless it is folded.
function section_lines(board: StressBoard, label: string, rows: ReadonlyArray<Line>): Array<Line> {
	const [name = ''] = label.split(' ', 1)

	return [rule(label, board), ...(is_folded(board, name) ? [] : rows)]
}

// The header's three rows, each with its pins at the board's right end.
function header(edge: number): Array<Line> {
	const rows = [
		['> josh-trace     -> 11-24 23:03  - 3°52′56″  MM  35% ■■---', '8911'],
		['  v1.3594.0+407  () 11-24 19:10  +24°23′59″  —  !! alert · #8897 Gate red', '8828'],
		['  kit            ^^ 11-23 18:46         12″  >  #8897 · Bash pnpm josh test:related', '8755'],
	]

	return rows.map(([text = '', pin = '']) =>
		body(`${cut(text, edge - PINS - PINS_GAP).padEnd(edge - PINS)}.. ${pin} —`),
	)
}

function panel_lines(board: StressBoard): Array<Line> {
	const width = board.px - LAMPS_PER_ROW
	const usage = Array.from({ length: board.panel_rows - ABOVE_USAGE }, () =>
		body(cut('     Claude        7d  81% ■■■■■■■■■┊■■■■■■----  ≈60 Sat 10:00', width)),
	)

	return [
		...section_lines(board, 'throughput', [
			body(cut('     24h  ▁▃▃█▆▅┊┊┊┊┊┊┊▁▄▄▄▁▄▅▃┊▄▁   2.2    14h     29    6.0     0', width)),
			body(cut('      7d  ▃█▇█▄▆▂▅▇▆▅▆▃▃             3.9   124h    474    5.2', width)),
			body(''),
		]),
		...section_lines(board, 'usage', usage),
	]
}

// A lane row, its issue number a hyperlink as the board draws it.
function lane_text(issue: string): string {
	const linked = `${ESC}]8;;${LINK_BASE}${issue}${ESC}\\${issue}${ESC}]8;;${ESC}\\`

	return `     SH      19″   15′39″      7.3      2.1        0.9 ${linked}    ** Carry run:board render cost  -> 19:37 +2′`
}

function lines_of(board: StressBoard): Array<Line> {
	const lanes = issues_of(board)
		.slice(0, board.lanes)
		.map((issue) => body(lane_text(issue)))
	const lines = [...header(board.edge), body(''), ...panel_lines(board), body('')]
	const finding = body(
		"     :  18:48       The supervisor's code changed on main, so process 52121 moved on.",
	)

	lines.push(
		...section_lines(board, `lanes ${String(board.lanes)}/3`, lanes),
		body(''),
		rule('processes', board),
	)
	while (lines.length < board.rows) lines.push(finding)

	return lines.slice(0, board.rows)
}

// The lamp panel beside THROUGHPUT and USAGE; none where either is folded (its rows are gone).
function lamps_of(board: StressBoard): Array<Lamp> {
	if (is_folded(board, 'throughput') || is_folded(board, 'usage')) return []

	return Array.from({ length: board.panel_rows }, (_, panel_row) =>
		Array.from({ length: LAMPS_PER_ROW }, (__, lamp) => ({
			row: FIRST_LAMP_ROW + panel_row,
			column: board.px + 1 + LAMPS_PER_ROW * lamp,
			panel_row,
			panel_rows: board.panel_rows,
			group: 0,
			lamp,
		})),
	).flat()
}

// The header's keyed notice and now line (1-based rows 2 and 3).
function header_keys(lines: ReadonlyArray<Line>): Array<KeyedLine> {
	const [, notice, progress] = lines

	return [
		{
			key: 'notice:x',
			index: 1,
			row: NOTICE_ROW,
			text: notice?.text ?? '',
			prefix_columns: NOTICE_X,
		},
		{
			key: 'now:x',
			index: NOTICE_ROW,
			row: HEADER_ROWS,
			text: progress?.text ?? '',
			prefix_columns: PROGRESS_X,
		},
	]
}

// A keyed row for each lane, from the row under the lanes' rule.
function lane_keys(board: StressBoard, lines: ReadonlyArray<Line>): Array<KeyedLine> {
	const first = lines.findIndex(({ text, is_rule }) => is_rule && text.includes(' lanes ')) + 1
	const shown = is_folded(board, 'lanes') ? 0 : board.lanes

	return issues_of(board)
		.slice(0, shown)
		.map((issue, index) => ({
			key: `lanes:${issue}`,
			index: first + index,
			row: first + index + 1,
			text: lines[first + index]?.text ?? '',
			prefix_columns: LANE_PREFIX,
		}))
}

// The places kit lays out on the board: its lamps, its keyed rows, the clocks' colons and spinners.
function view_of(board: StressBoard, lines: ReadonlyArray<Line>): LayoutView {
	const lanes = lane_keys(board, lines)
	const header_rows = Array.from({ length: HEADER_ROWS }, (_, index) => index + 1)
	const lane_spins = lanes.map(({ row }) => ({ row, column: LANE_SPIN, style: '' }))
	const spots = [{ row: HEADER_ROWS, column: SIGN_SPIN, style: '' }, ...lane_spins]

	return {
		lamps: lamps_of(board),
		keyed: [...header_keys(lines), ...lanes],
		colons: header_rows.map((row) => ({ row, column: COLON_COLUMN, style: '' })),
		spots: board.shape?.is_stopped ? [] : spots,
	}
}

// The board painted onto a canvas of its terminal's size, and the places kit laid out on it.
function stress_board(board: StressBoard): { cells: Cells; view: LayoutView; size: TerminalSize } {
	const size = { rows: board.rows, columns: board.columns }
	const lines = lines_of(board)
	const cells = run_board_cells.cells_of(size)
	const text = lines.map((line) => `${line.is_rule ? RULE : BODY}${cut(line.text, board.columns)}`)

	run_board_cells_ansi.paint(cells, text.join('\n'))

	return { cells, view: view_of(board, lines), size }
}

const run_board_theme_stress_fixture = { stress_board }

export { run_board_theme_stress_fixture }
export type { LiveShape, StressBoard }
