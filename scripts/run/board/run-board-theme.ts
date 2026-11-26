import { stripVTControlCharacters } from 'node:util'
import { CacheableMemory } from '@cacheable/memory'
import { run_board_icons, type Icons } from './run-board-icons'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_option, type OptionSpec } from './run-board-option'
import type { BoardPorts } from './run-board-state'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'
import { run_board_tint } from './run-board-tint'

// joshuafolkken/kit#7934: a theme for the board a person watches. A themed board's base is drawn in the
// base look (`run-board-theme-defs.ts` → `BASE_LOOK`; joshuafolkken/kit#8917): the text no color is
// given in its paint and every rule as a run of `-`, so each character of a line shows;
// joshuafolkken/kit#7988: each icon as text of its width (`run-board-theme-glyphs.ts`);
// joshuafolkken/kit#8150: that text in the color of the state its icon marks
// (`run-board-theme-tones.ts`). The theme host reads that base back as roles and paints it in the
// theme's own colors. It is put on the frame as it is written, once, so no render module carries it; a
// color a render module gives (red, yellow, …) is kept, the base paint resumed after it.

const THEME_ENV = 'JOSH_BOARD_THEME'
const { BASE_LOOK, THEMES, THEME_ALIASES } = run_board_theme_defs
const THEME_OPTION: OptionSpec<Theme> = {
	flag: '--theme',
	env: THEME_ENV,
	noun: 'theme',
	names: THEMES,
	aliases: THEME_ALIASES,
}
const RULE = '─'
const RULE_RUN = /─+/gu
const DASH = '-'
const { lit, open_of } = run_board_tint
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

interface ThemeChoice {
	theme: Theme | undefined
	argv: Array<string>
}

// What a themed line is drawn with: its theme and how its icons are drawn (`run-board-icons.ts`).
interface Look {
	theme: Theme
	icons: Icons
}

// The theme `--theme` names, else `JOSH_BOARD_THEME`, with the arguments left; `undefined` for a name
// no theme has.
function choose(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): ThemeChoice | undefined {
	const chosen = run_board_option.choose(argv, environment, THEME_OPTION)

	return chosen && { theme: chosen.name, argv: chosen.argv }
}

// The line that names `JOSH_BOARD_THEME` where it, not `--theme`, gave the name `choose` refused.
function refusal(argv: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): string {
	return run_board_option.refusal(argv, environment, THEME_OPTION)
}

// What `styleText` and the color depth read to decide whether, and in how many colors, stdout draws,
// as far as a running board can see it change: stdout's TTY and the color variables (a test stubs
// them); the terminal's other variables (`TMUX`, `CI`, …) are fixed before the board starts.
function color_inputs(): string {
	const named = COLOR_INPUTS.map((name) => process.env[name] ?? '')

	return [String(process.stdout.isTTY), ...named].join('\n')
}

// joshuafolkken/kit#8207: the theme color's escape, made again only when the look or what decides
// stdout's color changes; the lines drawn in the colors before are dropped with it.
function phosphor(look: Look): string {
	const inputs = `${look.theme}\n${look.icons}\n${color_inputs()}`

	if (inputs === memo.inputs) return memo.open
	memo.inputs = inputs
	memo.open = open_of(BASE_LOOK.paint)
	memo.lines.clear()

	return memo.open
}

// Only uncolored rule glyphs take the rule paint; render colors and tone colors keep their foreground.
function dimmed(rule: Paint, text: string): string {
	return run_board_theme_glyphs.mapped(text, (part, open) =>
		open.is_colored ? part : part.split(DASH).join(run_board_labels.painted(rule, DASH)),
	)
}

// The line's text as the base look writes it: rules as `-`, icons as text, a heading's `-` in the rule
// paint (joshuafolkken/kit#8917: every theme's base, the host painting it after).
function written(look: Look, kept: string, is_rule: boolean): string {
	const text = run_board_theme_glyphs.textual(kept.split(RULE).join(DASH), look)

	return is_rule ? dimmed(BASE_LOOK.rule.dash, text) : text
}

// joshuafolkken/kit#8154: an icon beside its label is dropped (`run-board-label-pair.ts`).
function restyled_line(open: string, look: Look, line: string): string {
	const kept = run_board_label_pair.dropped(line)
	const is_rule = run_board_label_pair.heading_lead(stripVTControlCharacters(kept)) !== undefined
	const text = written(look, kept, is_rule)

	return lit(is_rule ? open_of(BASE_LOOK.rule.text) : open, text)
}

// joshuafolkken/kit#8207: a line drawn before is taken from the cache — most lines of a redraw, and of
// a spinner's write, are the ones the write before drew. The cache is cleared with the look.
function remembered(open: string, look: Look, line: string): string {
	const kept = memo.lines.get<string>(line)

	if (kept !== undefined) return kept
	const drawn = restyled_line(open, look, line)

	memo.lines.set(line, drawn)

	return drawn
}

// Only heading rules take the gauge's dim; restoring intensity keeps a surrounding bold heading.
function dimmed_rules(line: string): string {
	const plain = stripVTControlCharacters(run_board_label_pair.untitled(line))

	if (run_board_label_pair.heading_lead(plain) === undefined) return line

	return run_board_theme_glyphs.mapped(line, (text, open) =>
		text.replaceAll(RULE_RUN, (rule) => {
			const drawn = run_board_labels.painted('dim', rule)

			return drawn === rule ? rule : drawn + open.intensity
		}),
	)
}

// joshuafolkken/kit#8505: in no theme, icons drawn as letters or shapes take their tone's color and
// nothing else — no capitals, no rule of `-`, no theme color.
function default_line(line: string, icons: Icons): string {
	return run_board_theme_glyphs.textual(dimmed_rules(line), { theme: undefined, icons })
}

// A frame is drawn a line at a time: the transforms change only text within a line, and a render
// module closes every color on the line it opens it (`styleText`), so the color `textual` reads
// across a line's end is the default it reads at a line's start. Its titles keep their marks, for
// the reveal that writes a title as one block (joshuafolkken/kit#8224). Unset icons are the theme's
// default (`run-board-icons.ts`).
function marked(
	theme: Theme | undefined,
	frame: string,
	icons: Icons = run_board_icons.default_of(theme),
): string {
	const lines = frame.split('\n')

	if (theme === undefined) return lines.map((line) => default_line(line, icons)).join('\n')
	const look = { theme, icons }
	const open = phosphor(look)

	return lines.map((line) => remembered(open, look, line)).join('\n')
}

// The frame as the theme draws it, its title marks dropped.
function restyle(theme: Theme | undefined, frame: string, icons?: Icons): string {
	return run_board_label_pair.untitled(marked(theme, frame, icons))
}

// The lines the cache holds, never past `LINE_LIMIT`.
function kept_lines(): number {
	return memo.lines.size
}

// Ports whose every write is put through the theme and the ports' icons, named so the header draws
// the theme's alert level; what the theme already drew goes past it.
function themed<P extends Pick<BoardPorts, 'icons' | 'theme' | 'write' | 'write_drawn'>>(
	ports: P,
	theme: Theme | undefined,
): P {
	return {
		...ports,
		theme,
		restyle: (text: string) => restyle(theme, text, ports.icons),
		write: (frame: string) => {
			ports.write(restyle(theme, frame, ports.icons))
		},
		write_drawn: ports.write,
	}
}

const run_board_theme = {
	LINE_LIMIT,
	THEME_ENV,
	THEMES,
	choose,
	kept_lines,
	marked,
	refusal,
	restyle,
	themed,
}

export { run_board_theme }

export { type Theme } from './run-board-theme-defs'
