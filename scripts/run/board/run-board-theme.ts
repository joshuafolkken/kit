import { CacheableMemory } from '@cacheable/memory'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels, type Paint } from './run-board-labels'
import type { BoardPorts } from './run-board-state'
import { run_board_theme_case } from './run-board-theme-case'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'

// joshuafolkken/kit#7934: a theme for the board a person watches — `wargames` draws the text no color
// is given in the cyan glow of the film's terminal phosphor and every rule as a run of `-`, so each
// character of a line shows; joshuafolkken/kit#7988: each icon as text of its width
// (`run-board-theme-glyphs.ts`) and the text uppercase, as a text terminal draws it;
// joshuafolkken/kit#8150: that text in the color of the state its icon marks
// (`run-board-theme-tones.ts`). It is put on the frame as it is written, once, so no render module
// carries it; a color a render module gives (red, yellow, …) is kept, the cyan resumed after it.

const THEME_FLAG = '--theme'
const THEME_ENV = 'JOSH_BOARD_THEME'
const THEMES = ['wargames'] as const
const THEME_NAMES: ReadonlySet<string> = new Set(THEMES)
// The cyan of the film terminal's phosphor glyph core in 24-bit color, else the palette's own cyan.
const PHOSPHOR: Paint = { rgb: '62;236;225', named: 'cyan' }
const RULE = '─'
const DASH = '-'
// The escapes that end a color and fall back to the terminal's default foreground: the default
// foreground itself, and a reset.
const DEFAULT_FOREGROUND = '\u{1B}[39m'
const RESET = '\u{1B}[0m'
// joshuafolkken/kit#8207: the themed lines kept — past a few frames of a resident board, so its spinner
// and redraws hit the cache while a board left for days holds no more.
const LINE_LIMIT = 1024
const COLOR_INPUTS = [
	'FORCE_COLOR',
	'NO_COLOR',
	'NODE_DISABLE_COLORS',
	'TERM',
	'COLORTERM',
] as const

type Theme = (typeof THEMES)[number]

interface Memo {
	inputs: string | undefined
	open: string
	lines: CacheableMemory
}

const memo: Memo = {
	inputs: undefined,
	open: '',
	lines: new CacheableMemory({ lruSize: LINE_LIMIT, useClone: false }),
}

interface Named {
	name: string | undefined
	argv: Array<string>
}

interface ThemeChoice {
	theme: Theme | undefined
	argv: Array<string>
}

function is_theme(name: string): name is Theme {
	return THEME_NAMES.has(name)
}

// `--theme <name>` and the arguments left without it; a flag with no name names `''`, which no theme is.
function from_flag(argv: ReadonlyArray<string>): Named | undefined {
	const at = argv.indexOf(THEME_FLAG)

	if (at === -1) return undefined

	return {
		name: argv[at + 1] ?? '',
		argv: argv.filter((_, index) => index !== at && index !== at + 1),
	}
}

function from_environment(argv: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): Named {
	const name = environment[THEME_ENV]

	return { name: name === '' ? undefined : name, argv: [...argv] }
}

// The theme `--theme` names, else `JOSH_BOARD_THEME`, with the arguments left; `undefined` for a name
// no theme has.
function choose(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): ThemeChoice | undefined {
	const { name, argv: rest } = from_flag(argv) ?? from_environment(argv, environment)

	if (name === undefined) return { theme: undefined, argv: rest }

	return is_theme(name) ? { theme: name, argv: rest } : undefined
}

// The line that names `JOSH_BOARD_THEME` where it, not `--theme`, gave the name `choose` refused.
function refusal(argv: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): string {
	if (argv.includes(THEME_FLAG)) return ''

	return `${THEME_ENV}=${environment[THEME_ENV] ?? ''} names no theme (${THEMES.join(', ')})\n`
}

// The escape that opens the phosphor color, as `painted` draws it — `''` where stdout draws no color,
// so the theme draws no escape where the board's own colors would not.
function phosphor_open(): string {
	const sample = run_board_labels.painted(PHOSPHOR, DASH)

	return sample.slice(0, sample.indexOf(DASH))
}

// What `styleText` and the color depth read to decide whether, and in how many colors, stdout draws,
// as far as a running board can see it change: stdout's TTY and the color variables (a test stubs
// them); the terminal's other variables (`TMUX`, `CI`, …) are fixed before the board starts.
function color_inputs(): string {
	const named = COLOR_INPUTS.map((name) => process.env[name] ?? '')

	return [String(process.stdout.isTTY), ...named].join('\n')
}

// joshuafolkken/kit#8207: the phosphor's escape, made again only when what decides stdout's color
// changes; the lines drawn in the colors before are dropped with it.
function phosphor(): string {
	const inputs = color_inputs()

	if (inputs === memo.inputs) return memo.open
	memo.inputs = inputs
	memo.open = phosphor_open()
	memo.lines.clear()

	return memo.open
}

function lit(open: string, line: string): string {
	if (open === '' || line === '') return line

	const resumed = line
		.split(DEFAULT_FOREGROUND)
		.join(open)
		.split(RESET)
		.join(RESET + open)

	return open + resumed + DEFAULT_FOREGROUND
}

// joshuafolkken/kit#8154: an icon beside its label is dropped (`run-board-label-pair.ts`).
function restyled_line(open: string, line: string): string {
	const ruled = run_board_label_pair.dropped(line).split(RULE).join(DASH)

	return lit(open, run_board_theme_case.capitals(run_board_theme_glyphs.textual(ruled)))
}

// joshuafolkken/kit#8207: a line drawn before is taken from the cache — most lines of a redraw, and of
// a spinner's write, are the ones the write before drew.
function remembered(open: string, line: string): string {
	const kept = memo.lines.get<string>(line)

	if (kept !== undefined) return kept
	const drawn = restyled_line(open, line)

	memo.lines.set(line, drawn)

	return drawn
}

// A frame is drawn a line at a time: the transforms change only text within a line, and a render
// module closes every color on the line it opens it (`styleText`), so the color `textual` reads
// across a line's end is the default it reads at a line's start.
function restyle(theme: Theme | undefined, frame: string): string {
	if (theme === undefined) return frame
	const open = phosphor()

	return frame
		.split('\n')
		.map((line) => remembered(open, line))
		.join('\n')
}

// The lines the cache holds, never past `LINE_LIMIT`.
function kept_lines(): number {
	return memo.lines.size
}

// Ports whose every write is put through the theme, marked so the header draws the alert level.
function themed<P extends Pick<BoardPorts, 'write' | 'is_themed'>>(
	ports: P,
	theme: Theme | undefined,
): P {
	if (theme === undefined) return ports

	return {
		...ports,
		is_themed: true,
		write: (frame: string) => {
			ports.write(restyle(theme, frame))
		},
	}
}

const run_board_theme = { LINE_LIMIT, THEME_ENV, choose, kept_lines, refusal, restyle, themed }

export { run_board_theme }
export type { Theme }
