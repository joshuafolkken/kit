import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout } from './run-board-layout'
import type { Link } from './run-board-link'
import type { BoardNote } from './run-board-notes'
import { run_board_render_drawn } from './run-board-render-drawn'
import { run_board_render_icon } from './run-board-render-icon'
import { run_board_render_legend } from './run-board-render-legend'
import { run_board_render_thanks } from './run-board-render-thanks'
import { run_board_render_waits } from './run-board-render-waits'
import type { Thanks } from './run-board-thanks-csv'

// The lines around a frame's rows that no row draws — pure: the command a stopped run resumes from
// under the header, and the reviewers thanked, the stray waits and the legend at the foot.

const { STATE_ICONS, WORDS } = run_board_labels
const GAP = '  '

// The command that resumes a stopped run's session, under the header where the person looks first.
function resume_lines(resume: string | undefined): Array<string> {
	if (resume === undefined) return []

	return ['', `${STATE_ICONS.human} ${WORDS.resume}${GAP}claude --resume ${resume}`]
}

// No legend is drawn before a plan is read, nor where the frame draws nothing it would name.
function legend_of(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Array<string> {
	const { layout } = header

	if (layout === undefined) return []

	const rows = run_board_layout.drawn_rows(layout)
	const leads = new Set(rows.map((row) => run_board_render_icon.state_icon(row)))
	const drawn = run_board_render_drawn.drawn_of(header, rows, leads)

	return run_board_render_legend.legend_of(rows, drawn, notes)
}

// The waits no lane row owns, right before the legend (joshuafolkken/kit#4052), and the legend.
function legend_lines(header: BoardHeader, notes: ReadonlyArray<BoardNote>): Array<string> {
	const lines = [...run_board_render_waits.stray_lines(header), ...legend_of(header, notes)]

	return lines.length === 0 ? [] : ['', ...lines]
}

// Names with no link where no terminal opens one: a frame with no `link` draws them plain.
function thanks_part(
	thanks: Thanks | undefined,
	link: Link | undefined,
	columns: number | undefined,
): Array<string> {
	const linked = link ?? ((text: string): string => text)

	return run_board_render_thanks.thanks_lines(thanks ?? [], linked, columns)
}

const run_board_render_foot = { legend_lines, resume_lines, thanks_part }

export { run_board_render_foot }
