import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardRow } from './run-board-layout'
import { run_board_render_checks } from './run-board-render-checks'
import type { LegendDrawn } from './run-board-render-legend'
import { run_board_render_tail } from './run-board-render-tail'
import { run_board_render_waits } from './run-board-render-waits'

// What a `run:board` frame draws, read for its legend (joshuafolkken/kit#4047): every icon a phase may be
// drawn with — the rows' leads, the header's third line and the rows' ends — the activity kinds their
// words leave unnamed, the header's estimated finish (joshuafolkken/kit#4044), and a followup row's checks
// (joshuafolkken/kit#3770).

const { HEADER_ICONS, NOW_ICONS, WORDS } = run_board_labels

function present(icons: ReadonlyArray<string | undefined>): Set<string> {
	return new Set(icons.filter((icon) => icon !== undefined))
}

// The lanes rule stands ⏰ over the lanes' times wherever a lanes section is drawn.
function has_lanes(header: BoardHeader): boolean {
	const { layout } = header

	return layout !== undefined && run_board_layout.lanes_drawn(layout).length > 0
}

// The third line's kinds, ⏰ where the lanes rule stands it over the lanes' times, then the estimated
// finish.
function named_of(header: BoardHeader, icons: ReadonlySet<string>): Array<string> {
	const is_operation = icons.has(NOW_ICONS.operation)
	const operation = is_operation ? `${NOW_ICONS.operation} ${WORDS.operation}` : undefined
	const elapsed = has_lanes(header) ? `${HEADER_ICONS.elapsed} ${WORDS.elapsed}` : undefined
	const legends = [
		run_board_header.now_legend(header),
		operation,
		elapsed,
		run_board_header.estimate_legend(header),
	]

	return legends.filter((legend) => legend !== undefined)
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
	const checks = rows.flatMap((row) => run_board_render_tail.checks_of(row, header) ?? [])

	return {
		leads,
		icons,
		named: named_of(header, icons),
		checks: run_board_render_checks.legend_of(checks),
		held: run_board_render_waits.legend_of(header),
	}
}

const run_board_render_drawn = { drawn_of }

export { run_board_render_drawn }
