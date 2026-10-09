import { run_board_labels } from './run-board-labels'
import type { Phase } from './run-board-phase'

// A running row's phases as a track (joshuafolkken/kit#3460): the icon of every phase it has passed, left
// to right, so how far a child has got and what it is doing now are one mark. **The track is a history**
// (joshuafolkken/kit#3526): it grows as the child goes and draws nothing ahead, since a ship that stops
// sends the child back and no fixed frame says how many rounds are left.

const { PHASE_ICONS } = run_board_labels

function track_of(track: ReadonlyArray<Phase>): string {
	return track.map((phase) => PHASE_ICONS[phase]).join('')
}

const run_board_track = { track_of }

export { run_board_track }
