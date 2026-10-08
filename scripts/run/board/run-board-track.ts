import { run_board_labels } from './run-board-labels'
import { run_board_phase, type Phase } from './run-board-phase'

// A running row's phase as a track (joshuafolkken/kit#3460): the icon of every phase it has passed, left
// to right, and a dim `──` for each one still ahead. An emoji is two columns, so the track is fourteen
// columns at every phase, and how far a child has got and what it is doing now are one mark. The header's
// gauges stay `bar_of`'s.

const { BAR_LEFT, BAR_LEFT_COLOR, PHASE_ICONS, painted } = run_board_labels
const AHEAD = `${BAR_LEFT}${BAR_LEFT}`

// The phases a track has a cell for: a dispatched child has passed none, and a merged one draws as a
// closed row (joshuafolkken/kit#3451), never as a track.
const TRACK_PHASES: ReadonlyArray<Phase> = run_board_phase.PHASES.filter(
	(phase) => phase !== 'dispatched' && phase !== 'merged',
)

// The track's phases a child at `phase` has reached, its own included.
function passed_of(phase: Phase): Array<Phase> {
	const reached = run_board_phase.index_of(phase)

	return TRACK_PHASES.filter((step) => run_board_phase.index_of(step) <= reached)
}

function track_of(phase: Phase): string {
	const passed = passed_of(phase)
	const icons = passed.map((step) => PHASE_ICONS[step]).join('')

	return icons + painted(BAR_LEFT_COLOR, AHEAD.repeat(TRACK_PHASES.length - passed.length))
}

const run_board_track = { passed_of, track_of }

export { run_board_track }
