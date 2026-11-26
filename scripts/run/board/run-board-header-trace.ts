import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8354: the green phosphor palette and its alert field, `TRACE ■■■■-` — the base
// look every themed board draws over (joshuafolkken/kit#8917, `run-board-theme-defs.ts` → `BASE_LOOK`).
// The level is the one every theme shares (`run-board-header-defcon.ts` → `level_of`), 5 calm and 1 the
// worst: each level nearer 1 fills one more cell, and at 1 the whole field is drawn in failure red.

const LABEL = 'TRACE'
const FILLED = '■'
const EMPTY = '-'
const CELLS = 5
const WORST = 1
const ALERT_TEXT = `${LABEL} ${FILLED.repeat(CELLS)}`

// The green phosphor in 24-bit color, from the brightest to the darkest, and the white-green of a
// leading character; where stdout has no 24-bit color each falls back to the palette's green.
const SHADES = {
	bright: { rgb: '0;255;65', named: 'green' },
	body: { rgb: '0;215;60', named: 'green' },
	mid: { rgb: '0;165;40', named: 'green' },
	dark: { rgb: '0;100;22', named: 'green' },
	darkest: { rgb: '0;55;12', named: 'green' },
	head: { rgb: '225;255;225', named: 'green' },
} as const satisfies Readonly<Record<string, Paint>>

const { GAUGE_SHADES, painted } = run_board_labels

// The cells filled at a level: one at 5, all of them at 1.
function filled_of(level: number): number {
	return Math.min(CELLS, Math.max(0, CELLS + 1 - level))
}

function gauge_of(level: number): string {
	const filled = filled_of(level)

	return `${painted(SHADES.bright, FILLED.repeat(filled))}${painted(SHADES.dark, EMPTY.repeat(CELLS - filled))}`
}

// The worst field starts with a one-column marker, drawn back as T in every frame.
function field_of(level: number): string {
	if (level > WORST) return `${LABEL} ${gauge_of(level)}`

	return painted(GAUGE_SHADES.red, `${run_board_spot.TRACE}${ALERT_TEXT.slice(1)}`)
}

const run_board_header_trace = { SHADES, field_of }

export { run_board_header_trace }
