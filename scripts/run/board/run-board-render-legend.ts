import { styleText } from 'node:util'
import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { run_board_kind } from './run-board-kind'
import { run_board_labels, type Words } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_phase } from './run-board-phase'
import { run_board_render_notes } from './run-board-render-notes'
import type { ItemState } from './run-board-status'

// The legend at the foot of `run:board`: the symbols named once, so a row carries only what differs
// between rows. Drawn apart from the rows, which tell it the icons they lead with.

const { FILED_KIND_ICONS, KIND_WORDS, PHASE_ICONS, PHASE_WORDS, STATE_ICONS, WAITS_ICON, WORDS } =
	run_board_labels
const GAP = '  '

// Every phase a run passes through, in the track's own order and whatever is on screen: a row's phase
// moves between redraws, so fixed lines keep each icon where the eye last found it — six to a line, so
// the twelve fit a narrow pane.
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
// named only while a row draws it.
function state_legend(drawn: ReadonlySet<string>): Array<string> {
	return STATE_LEGEND.filter(([state]) => drawn.has(STATE_ICONS[state])).map(
		([state, word]) => `${STATE_ICONS[state]} ${WORDS[word]}`,
	)
}

// The release kinds the rows draw (joshuafolkken/kit#3577), in the release notes' order.
function kinds_of(rows: ReadonlyArray<BoardRow>): Array<FiledKind> {
	const drawn = new Set(rows.map((row) => row.kind))

	return run_board_kind.KIND_ORDER.filter((kind) => drawn.has(kind))
}

function waits_legend(rows: ReadonlyArray<BoardRow>): Array<string> {
	return rows.some((row) => row.waits.length > 0) ? [`${WAITS_ICON} ${WORDS.waits}`] : []
}

// The phases on their lines and what the screen draws on one more, drawn only when it names something.
// The header's gauges and marks read by their place, so the legend leaves them.
// `drawn` is the icons the rows lead with.
function legend_of(
	rows: ReadonlyArray<BoardRow>,
	drawn: ReadonlySet<string>,
	notes: ReadonlyArray<BoardNote>,
): Array<string> {
	const kinds = kinds_of(rows)
	const kind_icons = kinds.map((kind) => FILED_KIND_ICONS[kind])
	const notes_named = run_board_render_notes.notes_legend(notes, new Set([...drawn, ...kind_icons]))
	const kind_named = kinds.map((kind) => `${FILED_KIND_ICONS[kind]} ${WORDS[KIND_WORDS[kind]]}`)
	const shown = [...state_legend(drawn), ...kind_named, ...waits_legend(rows), ...notes_named]
	const lines = shown.length === 0 ? PHASE_LEGEND : [...PHASE_LEGEND, shown.join(GAP)]

	return lines.map((line) => styleText('dim', line))
}

const run_board_render_legend = {
	legend_of,
}

export { run_board_render_legend }
