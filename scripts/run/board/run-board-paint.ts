import { WriteStream } from 'node:tty'
import { styleText } from 'node:util'

// How the board colors a text: a palette color through `styleText`, or a shade in 24-bit color where
// stdout draws it. Whether stdout draws color at all is `styleText`'s answer alone (a pipe, `NO_COLOR`
// draw none), so a shade draws no escape where its palette color would not.

type TextColor = Parameters<typeof styleText>[0]

// A color that does not depend on the terminal's palette: `rgb` as the
// `38;2;R;G;B` escape takes it, drawn where the output has 24-bit color, and `named` — the palette's own
// — where it does not.
interface Shade {
	rgb: string
	named: TextColor
}

type Paint = TextColor | Shade

type Painter = (color: Paint | undefined, text: string) => string

// The color depth from which a terminal draws a 24-bit color, and the escapes that draw one.
const RGB_COLOR_DEPTH = 24
const ESC = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESC}[39m`
// The depth of a stdout that draws no color, and the text `styleText` is asked to color to find out.
const NO_COLOR_DEPTH = 1
const PROBE = 'x'
const PROBE_COLOR: TextColor = 'cyan'
const UNCHECKED = { validateStream: false } as const

function is_shade(color: Paint): color is Shade {
	return typeof color === 'object' && 'rgb' in color
}

// How many colors stdout draws, `NO_COLOR_DEPTH` where `styleText` draws none.
function color_depth(): number {
	if (styleText(PROBE_COLOR, PROBE) === PROBE) return NO_COLOR_DEPTH

	return WriteStream.prototype.getColorDepth()
}

// A text in its color at a color depth already read: a shade in 24-bit color where the depth draws it,
// else its palette color.
function painted_at(depth: number, color: Paint, text: string): string {
	if (depth === NO_COLOR_DEPTH) return text
	if (!is_shade(color)) return styleText(color, text, UNCHECKED)
	if (depth < RGB_COLOR_DEPTH) return styleText(color.named, text, UNCHECKED)

	return `${ESC}[38;2;${color.rgb}m${text}${DEFAULT_FOREGROUND}`
}

// A text in its color; an empty text, or no color, draws no escape, so a gauge never disagrees with
// the rest of the board about it.
function painted(color: Paint | undefined, text: string): string {
	if (color === undefined || text === '') return text

	return is_shade(color) ? painted_at(color_depth(), color, text) : styleText(color, text)
}

// joshuafolkken/kit#8897: `painted` with stdout's color depth read once, for a frame that paints
// thousands of cells — reading it per cell (the environment, each time) stalled the matrix reveal.
function painter(): Painter {
	const depth = color_depth()

	return (color, text) =>
		color === undefined || text === '' ? text : painted_at(depth, color, text)
}

const run_board_paint = {
	RGB_COLOR_DEPTH,
	color_depth,
	painted,
	painter,
}

export { run_board_paint }
export type { Paint, Painter, Shade, TextColor }
