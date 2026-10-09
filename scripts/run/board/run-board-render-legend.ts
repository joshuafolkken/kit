import { styleText } from 'node:util'
import { run_board_labels, type Words } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_phase } from './run-board-phase'
import { run_board_render_notes } from './run-board-render-notes'
import type { ItemState } from './run-board-status'

// The legend at the foot of `run:board` (joshuafolkken/kit#3444): the symbols named once, so a row
// carries only what differs between rows. Drawn apart from the rows (joshuafolkken/kit#3544), which
// tell it the icons they lead with.

const { PHASE_ICONS, PHASE_WORDS, STATE_ICONS, WAITS_ICON, WORDS } = run_board_labels
const GAP = '  '

// Every phase a run passes through, in the track's own order and whatever is on screen
// (joshuafolkken/kit#3480): a row's phase moves between redraws, so fixed lines keep each icon where
// the eye last found it — six to a line (joshuafolkken/kit#3526), so the twelve fit a narrow pane.
const PHASES_PER_LINE = 6
const PHASE_ENTRIES = run_board_phase.PHASES.map(
	(phase) => `${PHASE_ICONS[phase]} ${WORDS[PHASE_WORDS[phase]]}`,
)
const PHASE_LEGEND = Array.from(
	{ length: Math.ceil(PHASE_ENTRIES.length / PHASES_PER_LINE) },
	(_, line) => PHASE_ENTRIES.slice(line * PHASES_PER_LINE, (line + 1) * PHASES_PER_LINE).join(GAP),
)

// The row states the legend can name, in its order, each with its word.
const STATE_LEGEND: ReadonlyArray<readonly [ItemState, keyof Words]> = [
	['merged', 'merged'],
	['parked', 'parked'],
	['done', 'done'],
	['running', 'in_progress'],
	['stopped', 'stopped'],
	['waiting', 'waiting'],
	['human', 'decision'],
]

// The states some row on screen leads with (`drawn`) — a running row leads with its phase, so 🔄 is
// named only while a row draws it (joshuafolkken/kit#3480).
function state_legend(drawn: ReadonlySet<string>): Array<string> {
	return STATE_LEGEND.filter(([state]) => drawn.has(STATE_ICONS[state])).map(
		([state, word]) => `${STATE_ICONS[state]} ${WORDS[word]}`,
	)
}

function waits_legend(rows: ReadonlyArray<BoardRow>): Array<string> {
	return rows.some((row) => row.waits.length > 0) ? [`${WAITS_ICON} ${WORDS.waits}`] : []
}

// The phases on their lines and what the screen draws on one more, drawn only when it names something
// (joshuafolkken/kit#3480). The header's gauges and marks read by their place, so the legend leaves them.
// `drawn` is the icons the rows lead with.
function legend_of(
	rows: ReadonlyArray<BoardRow>,
	drawn: ReadonlySet<string>,
	notes: ReadonlyArray<BoardNote>,
): Array<string> {
	const notes_named = run_board_render_notes.notes_legend(notes, drawn)
	const shown = [...state_legend(drawn), ...waits_legend(rows), ...notes_named]
	const lines = shown.length === 0 ? PHASE_LEGEND : [...PHASE_LEGEND, shown.join(GAP)]

	return lines.map((line) => styleText('dim', line))
}

const run_board_render_legend = {
	legend_of,
}

export { run_board_render_legend }
