import { styleText } from 'node:util'
import { run_board_labels, type Paint } from './run-board-labels'

// joshuafolkken/kit#8150: the WarGames theme draws every icon as text (`run-board-theme-glyphs.ts`),
// so the text is drawn in the color of the state the icon marks — a failure red, a decision waiting on
// a person magenta — and read without the color too. The red, yellow and green are the machine
// gauges' own (`GAUGE_SHADES`); the rest are the theme's.

const TONES = ['alert', 'caution', 'human', 'done', 'running', 'idle', 'info'] as const

type Tone = (typeof TONES)[number]

const { GAUGE_SHADES, painted } = run_board_labels

// The color of each tone; `info` is left in the theme's phosphor cyan. Where stdout has no 24-bit
// color the idle tone is the cyan dimmed, as the phosphor's own palette color.
const TONE_PAINTS: Readonly<Record<Tone, Paint | undefined>> = {
	alert: GAUGE_SHADES.red,
	caution: GAUGE_SHADES.yellow,
	human: { rgb: '255;95;215', named: 'magentaBright' },
	done: GAUGE_SHADES.normal,
	running: { rgb: '255;255;255', named: 'whiteBright' },
	idle: { rgb: '31;118;113', named: 'dim' },
	info: undefined,
}

// Text in its tone's color, and the running tone bold too; `painted` and `styleText` draw no escape
// where stdout draws no color. The bold closes itself, so the line after it is not bold.
function toned(tone: Tone, text: string): string {
	const colored = painted(TONE_PAINTS[tone], text)

	return tone === 'running' ? styleText('bold', colored) : colored
}

const run_board_theme_tones = { TONES, TONE_PAINTS, toned }

export { run_board_theme_tones }
export type { Tone }
