import type { Lamp } from './run-board-lamp-spots'
import type { Spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'
import type { KeyedLine, Typing } from './run-board-type-rows'

// What a live `run:board` frame turns between redraws: the spinners and the colons, and what a theme
// layer lays itself out by (joshuafolkken/kit#8917). How each is drawn is its layer's
// (`run-board-layer-spin.ts`, `run-board-theme-layer.ts`).

const CSI = '\u{1B}['
const RESET = `${CSI}0m`

// What is written between redraws: the spinners turned and the colons blinked; on a themed board, the
// rows typing, the lamps, the keyed rows and the alert level the theme layer reads.
interface Turning {
	spots: ReadonlyArray<Spot>
	typing: Typing
	lamps?: ReadonlyArray<Lamp> | undefined
	// The header clocks' colons, blinked every half second (`run-board-colon.ts`).
	colons?: ReadonlyArray<Spot> | undefined
	keyed?: ReadonlyArray<KeyedLine> | undefined
	alert_level?: number | undefined
	dated_clocks?: ReadonlyArray<string> | undefined
}

type SpinPorts = Pick<
	BoardPorts,
	| 'now'
	| 'sleep'
	| 'write'
	| 'write_drawn'
	| 'time_draw'
	| 'time_wake'
	| 'typing_sound'
	| 'size'
	| 'drained'
	| 'restyle'
	| 'theme_run'
	| 'theme'
>

// One spinner frame at every spot: the cursor moved there, the spot's colors, the frame, then a reset.
function spin_bytes(spots: ReadonlyArray<Spot>, frame: string): string {
	return spots
		.map((spot) => `${CSI}${String(spot.row)};${String(spot.column)}H${spot.style}${frame}${RESET}`)
		.join('')
}

function colons_of(turning: Turning): ReadonlyArray<Spot> {
	return turning.colons ?? []
}

const run_board_spin_turn = {
	colons_of,
	spin_bytes,
}

export { run_board_spin_turn }
export type { SpinPorts, Turning }
