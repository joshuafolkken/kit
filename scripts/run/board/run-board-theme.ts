import { run_board_labels, type Paint } from './run-board-labels'
import type { BoardPorts } from './run-board-state'
import { run_board_theme_case } from './run-board-theme-case'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'

// joshuafolkken/kit#7934: a theme for the board a person watches — `wargames` draws the text no color
// is given in the cyan glow of the film's terminal phosphor and every rule as a run of `-`, so each
// character of a line shows; joshuafolkken/kit#7988: each icon as text of its width
// (`run-board-theme-glyphs.ts`) and the text uppercase, as a text terminal draws it. It is put on the frame as it is written, once, so no render module carries
// it; a color a render module gives (red, yellow, …) is kept, the cyan resumed after it.

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

type Theme = (typeof THEMES)[number]

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

function lit(open: string, line: string): string {
	if (open === '' || line === '') return line

	const resumed = line
		.split(DEFAULT_FOREGROUND)
		.join(open)
		.split(RESET)
		.join(RESET + open)

	return open + resumed + DEFAULT_FOREGROUND
}

function restyle(theme: Theme | undefined, frame: string): string {
	if (theme === undefined) return frame
	const open = phosphor_open()
	const ruled = frame.split(RULE).join(DASH)

	return run_board_theme_case
		.capitals(run_board_theme_glyphs.textual(ruled))
		.split('\n')
		.map((line) => lit(open, line))
		.join('\n')
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

const run_board_theme = { THEME_ENV, choose, refusal, restyle, themed }

export { run_board_theme }
export type { Theme }
