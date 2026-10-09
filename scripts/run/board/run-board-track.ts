import { run_board_labels } from './run-board-labels'
import type { Phase } from './run-board-phase'
import type { ItemState } from './run-board-status'

// A row's phases as a track: the icon of every phase it has passed, left to right, so how far a child
// has got and what it is doing now are one mark. **The track is a history**: it grows as the child
// goes and draws nothing ahead, since a ship that stops sends the child back and no fixed frame says
// how many rounds are left.

const { PHASE_ICONS, STATE_ICONS } = run_board_labels

// A settled row's track ends on the row's own state icon rather than a fixed ✅, so a child that
// stopped or parked never reads as having succeeded.
function track_of(track: ReadonlyArray<Phase>, state: ItemState = 'running'): string {
	const end = state === 'running' ? '' : STATE_ICONS[state]

	return `${track.map((phase) => PHASE_ICONS[phase]).join('')}${end}`
}

const run_board_track = { track_of }

export { run_board_track }
