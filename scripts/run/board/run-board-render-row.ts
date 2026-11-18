import { run_board_earlier } from './run-board-earlier'
import { run_board_fit, type PlanLine, type YieldStage } from './run-board-fit'
import { run_board_fresh } from './run-board-fresh'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_priority } from './run-board-priority'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_found } from './run-board-render-found'
import { run_board_render_icon } from './run-board-render-icon'
import { run_board_render_lanes, type LaneCells } from './run-board-render-lanes'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_render_tail } from './run-board-render-tail'
import { run_board_render_time } from './run-board-render-time'
import { run_board_render_title, type RowCut, type RowFit } from './run-board-render-title'
import { run_board_row_yield } from './run-board-row-yield'

// One issue row of the `run:board` screen as a plan line — its lead, title, time, tail and what was
// filed during it, fitted to the pane. The sections that place the rows are `run-board-render.ts`.

const { FILED_KIND_ICONS, KIND_BLANK } = run_board_labels
const { net_of, time_of } = run_board_render_time
const { state_icon } = run_board_render_icon
const { number_text } = run_board_render_lanes
const { indent_of, lead_of: lane_lead_of, running_fresh } = run_board_render_lead
const { ELLIPSIS, fitted, row_overrun, title_of } = run_board_render_title
const { width_of } = run_board_fit
const { padded } = run_board_fresh
const { condition_of, tail_of, waits_of } = run_board_render_condition
const GAP = '  '
// The fewest columns a done row's end is cut to before its title gives them up: its minutes and a cut
// start of what follows.
const FOUND_FLOOR = 8
const FILED_LEAD = `${run_board_labels.FILED_RUN_MARK} `

// What every row of one frame is drawn with: the header, how wide the time column is, so a
// `2°05′30″` and a `42″` end in the same column, and the lane cells after a row's lead where its
// section draws them.
interface RowFrame {
	header: BoardHeader
	time_width: number
	cells?: LaneCells | undefined
	// The columns a row's title is cut to: the title column's, or fewer where a row gives some up.
	title_limit: number
	// The columns cut off the end of a row's reason, where its title alone could not give up enough.
	reason_cut: number
	// The pane's width where the frame is kept within one.
	columns: number | undefined
	// The issues the run filed, whose rows lead their title with ✚.
	filed: ReadonlySet<number>
	// The columns a lane row that draws a tail gives up with every other such row.
	shared?: number | undefined
	// The queued, waiting and done sections draw a condition column this wide after the icon, one width
	// in all three (joshuafolkken/kit#4288, #4292, #7695); `undefined` where a section draws none.
	condition_width?: number | undefined
	// The lanes section draws each row's lead — progress, phase and times — before its cells
	// (`run-board-render-lead.ts`).
	is_lane_row?: boolean | undefined
	// A done row whose title gives up the columns draws what was filed during it whole.
	is_end_kept?: boolean | undefined
}

// A row drawn before the plan is read has no title yet, and says so.
function row_title(row: BoardRow, header: BoardHeader): string | undefined {
	if (row.title !== undefined || run_board_header.is_plan_read(header)) return row.title

	return ELLIPSIS
}

// A row the run filed leads its title with ✚ (joshuafolkken/kit#4099), cut by as many columns, so every
// column after it stays where an unmarked row has it.
function title_text(row: BoardRow, frame: RowFrame): string {
	const title = row_title(row, frame.header)

	if (!frame.filed.has(row.number)) return title_of(title, frame.title_limit)

	return `${FILED_LEAD}${title_of(title, frame.title_limit - FILED_LEAD.length)}`
}

// The time padded by its net time to the time column — blanks where a row has none — so the net times
// end in one column and the host's stops follow them bracketed (joshuafolkken/kit#7992).
function time_text(row: BoardRow, frame: RowFrame): string {
	const { header } = frame
	const time = time_of(row, header.now_ms) ?? ''
	const fresh = running_fresh(row, time, row.status?.started_ms, header)

	return padded(net_of(row, header.now_ms) ?? '', frame.time_width, fresh)
}

// The title padded to the title column, then the time; a waiting row's title is not padded. A lane row
// draws its time in its lead.
function timed_parts(row: BoardRow, frame: RowFrame): Array<string> {
	const title = title_text(row, frame)

	if (row.state === 'waiting') return [title]
	if (frame.is_lane_row === true) return [title.padEnd(frame.title_limit)]

	return [title.padEnd(frame.title_limit), time_text(row, frame)]
}

function joined(parts: ReadonlyArray<string | undefined>): string {
	return parts.filter((part) => part !== undefined && part !== '').join(GAP)
}

// A lane row's lead, else the icon and, in a section that draws one, the condition column after it.
function icon_text(row: BoardRow, frame: RowFrame): string {
	const { header } = frame

	if (frame.is_lane_row === true) return lane_lead_of(row, header)

	const icon = running_fresh(row, state_icon(row), row.status?.phase_ms, header)

	const width = frame.condition_width

	return width === undefined ? icon : `${icon} ${condition_of(row, header, width)}`
}

// The priority and the release kind's icons between the number — and its lane cells, where drawn —
// and the title, one space either side; a row with no title ends at its kind, so what follows keeps
// its usual gap.
function lead_of(row: BoardRow, frame: RowFrame, title: string): string {
	const { header } = frame
	const kind = row.kind === undefined ? KIND_BLANK : FILED_KIND_ICONS[row.kind]
	const number = number_text(row, frame.cells, header.link)
	const lead = `${icon_text(row, frame)} ${number} ${run_board_priority.cell_of(row)} ${kind}`

	return title === '' ? lead : `${lead} ${title}`
}

// A row up to its tail — the columns that stay where they are on every row. A waiting row has no time
// to line up, so it ends at its title and what it waits on follows two blanks on.
function head_text(row: BoardRow, frame: RowFrame): string {
	const [title = '', time] = timed_parts(row, frame)
	const lead = lead_of(row, frame, title)

	if (row.state === 'waiting') return lead

	return joined([lead, time])
}

// What a row draws after its title: its tail, an earlier run's row's led by 🧳 — so an earlier run's row
// draws one even where its tail is empty.
function drawn_tail(row: BoardRow, frame: RowFrame): Array<string> {
	return run_board_earlier.earlier_marked(row, run_board_render_tail.tail_of(row, frame.header))
}

// A row up to what was filed during it: its head, then what it draws after its title.
function tailed_head(row: BoardRow, frame: RowFrame): string {
	return joined([head_text(row, frame), ...drawn_tail(row, frame)])
}

// The columns the pane leaves after `head` and its gap, where the frame is kept within one and the
// row's end is not kept whole.
function room_after(indent: string, head: string, frame: RowFrame): number | undefined {
	if (frame.columns === undefined || frame.is_end_kept === true) return undefined

	return frame.columns - width_of(`${indent}${head}${GAP}`)
}

// Every row carries its state's icon, or the icon of what it waits on; a running row ends on its tail
// (`run-board-render-tail.ts`), a done row on what was filed during it (`run-board-render-found.ts`),
// and a row with nothing after its padded columns ends where its text does.
function row_text(indent: string, row: BoardRow, frame: RowFrame): string {
	const { header, reason_cut } = frame
	const head = tailed_head(row, frame)
	const found = run_board_render_found.found_fitted(room_after(indent, head, frame), row, header)
	const notes = [waits_of(row, header, frame.condition_width), tail_of(row, reason_cut, header)]

	return `${indent}${joined([head, found, ...notes]).trimEnd()}`
}

// A pane narrower than a done row's head leaves its end too few columns to say anything in, so there
// the title gives up the columns instead, as before joshuafolkken/kit#4922.
function is_found_squeezed(indent: string, row: BoardRow, frame: RowFrame): boolean {
	if (run_board_render_found.found_text(row, frame.header) === '') return false

	return (room_after(indent, tailed_head(row, frame), frame) ?? FOUND_FLOOR) < FOUND_FLOOR
}

// A row drawn whole or cut, after its indent; a row that keeps its line keeps its end whole too, its
// title giving up the columns.
function row_draw(
	indent: string,
	row: BoardRow,
	frame: RowFrame,
	fit: RowFit,
): (cut: RowCut) => string {
	const is_end_kept = fit.is_line_kept === true

	return (cut) => row_text(indent, row, { ...frame, ...cut, is_end_kept })
}

// A row drawn with lane cells keeps its head on one line, its title giving up their columns where the
// pane is narrow. A row that draws a tail keeps its whole line, giving up the columns its section's
// rows give up together (joshuafolkken/kit#4226). A done row keeps its title's width and cuts the end of
// what was filed during it instead (`run-board-render-found.ts` found_fitted), unless that end is
// squeezed out.
function row_fit(indent: string, row: BoardRow, frame: RowFrame): RowFit {
	const is_tailed = drawn_tail(row, frame).length > 0

	return {
		is_line_kept: is_tailed || is_found_squeezed(indent, row, frame),
		lead: frame.filed.has(row.number) ? FILED_LEAD.length : 0,
		head: (cut) => `${indent}${head_text(row, { ...frame, ...cut })}`,
		is_head_kept: frame.is_lane_row === true,
		shared: is_tailed ? frame.shared : undefined,
	}
}

// A plan line that draws one issue row, and one that draws none — a blank, a rule, an epic's own line.
function row_line(indent: string, row: BoardRow, frame: RowFrame, stage?: YieldStage): PlanLine {
	const fit = row_fit(indent, row, frame)
	const text = fitted(row, frame.columns, row_draw(indent, row, frame, fit), fit)

	return { text, row: run_board_row_yield.yield_of(row, stage) }
}

// The most columns a lane row that draws a tail runs past the pane, which every such row gives up, so
// their titles end in one column and the tails after them start in one.
function shared_overrun(rows: ReadonlyArray<BoardRow>, frame: RowFrame): number {
	const overruns = rows.map((row) => {
		const fit = row_fit(indent_of(row), row, frame)

		return fit.is_line_kept === true
			? row_overrun(row, frame.columns, row_draw(indent_of(row), row, frame, fit), fit)
			: 0
	})

	return Math.max(0, ...overruns)
}

const run_board_render_row = {
	GAP,
	head_text,
	row_draw,
	row_fit,
	row_line,
	shared_overrun,
}

export { run_board_render_row }
export type { RowFrame }
