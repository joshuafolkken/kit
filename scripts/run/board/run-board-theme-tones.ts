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
const IDLE_PAINT: Paint = { rgb: '31;118;113', named: 'dim' }
const TONE_PAINTS = {
	alert: GAUGE_SHADES.red,
	caution: GAUGE_SHADES.yellow,
	human: { rgb: '255;95;215', named: 'magentaBright' },
	done: GAUGE_SHADES.normal,
	running: { rgb: '255;255;255', named: 'whiteBright' },
	idle: undefined,
	info: undefined,
} as const satisfies Readonly<Record<Tone, Paint | undefined>>

// The paints a themed board's base draws its idle and info marks in — colors no other text of the base
// has, so the theme host reads each mark back as its own role (`run-board-theme-roles.ts`) and a theme
// paints it apart from its body. Where stdout has no 24-bit color both are the base's own green.
const MARK_PAINTS = {
	idle: { rgb: '0;150;36', named: 'green' },
	info: { rgb: '0;200;56', named: 'green' },
} as const satisfies Readonly<Record<string, Paint>>

// The paint of a tone: the idle tone's `idle`, the info tone's `info` — none on a board in no theme —
// else the tone's own.
function paint_of(tone: Tone, idle: Paint, info: Paint | undefined): Paint | undefined {
	const paints: Readonly<Record<Tone, Paint | undefined>> = { ...TONE_PAINTS, idle, info }

	return paints[tone]
}

// Text in its tone's color, and the running tone bold too; `painted` and `styleText` draw no escape
// where stdout draws no color. The bold closes itself, so the line after it is not bold.
function toned(tone: Tone, text: string, idle: Paint = IDLE_PAINT, info?: Paint): string {
	const colored = painted(paint_of(tone, idle, info), text)

	return tone === 'running' ? styleText('bold', colored) : colored
}

const run_board_theme_tones = { MARK_PAINTS, TONES, TONE_PAINTS, toned }

export { run_board_theme_tones }
export type { Tone }
