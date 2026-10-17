import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_checks } from './run-board-render-checks'
import type { LegendDrawn } from './run-board-render-legend'
import { run_board_render_tail } from './run-board-render-tail'
import { run_board_render_waits } from './run-board-render-waits'

// What a `run:board` frame draws, read for its legend (joshuafolkken/kit#4047): every icon a phase may be
// drawn with — the rows' leads, the header's third line and the rows' ends — the activity kinds their
// words leave unnamed, the header's estimated finish (joshuafolkken/kit#4044), and a followup row's checks
// (joshuafolkken/kit#3770).

const { NOW_ICONS, WORDS } = run_board_labels

function present(icons: ReadonlyArray<string | undefined>): Set<string> {
	return new Set(icons.filter((icon) => icon !== undefined))
}

// `leads` is the icons the rows lead with, which the frame's rows already know.
function drawn_of(
	header: BoardHeader,
	rows: ReadonlyArray<BoardRow>,
	leads: ReadonlySet<string>,
): LegendDrawn {
	const ends = rows.flatMap((row) => [
		run_board_render_tail.phase_icon(row),
		run_board_render_tail.activity_icon(row, header),
	])
	const icons = present([...leads, run_board_header.now_icon(header), ...ends])
	const legends = [run_board_header.estimate_legend(header), run_board_header.now_legend(header)]
	const is_operation = icons.has(NOW_ICONS.operation)
	const operation = is_operation ? [`${NOW_ICONS.operation} ${WORDS.operation}`] : []
	const checks = rows.flatMap((row) => run_board_render_tail.checks_of(row, header) ?? [])

	return {
		leads,
		icons,
		named: [...legends.filter((legend) => legend !== undefined), ...operation],
		checks: run_board_render_checks.legend_of(checks),
		held: run_board_render_waits.legend_of(header),
	}
}

const run_board_render_drawn = { drawn_of }

export { run_board_render_drawn }
