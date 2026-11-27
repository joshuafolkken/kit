import { run_board_paint } from './run-board-paint'
import { run_board_theme_codec } from './run-board-theme-codec'
import type { Theme } from './run-board-theme-defs'
import { run_board_theme_deviant } from './run-board-theme-deviant'
import { run_board_theme_flux } from './run-board-theme-flux'
import { run_board_theme_ghost } from './run-board-theme-ghost'
import type { ThemeFactory } from './run-board-theme-host-types'
import { run_board_theme_isac } from './run-board-theme-isac'
import { run_board_theme_magi } from './run-board-theme-magi'
import { run_board_theme_nixie } from './run-board-theme-nixie'
import { run_board_theme_run, type ThemeRun, type ThemeValue } from './run-board-theme-run'
import { run_board_theme_skynet } from './run-board-theme-skynet'
import { run_board_theme_sound, type OpeningSound } from './run-board-theme-sound'
import { run_board_theme_trace } from './run-board-theme-trace'
import { run_board_theme_wopr } from './run-board-theme-wopr'

// The theme host's works by their theme value (joshuafolkken/kit#8917): the value after `josh-` in the
// board's name, each drawn by its port of the confirmed demo. A live board launched in a theme is drawn
// by its work wherever the terminal draws 24-bit color; elsewhere it stays the board without a theme.
// Every value is a canonical one: an alias is read as its value where `--theme` is parsed
// (`run-board-theme-defs.ts` → `THEME_ALIASES`).

const FACTORIES: ReadonlyMap<ThemeValue, ThemeFactory> = new Map<ThemeValue, ThemeFactory>([
	['wopr', run_board_theme_wopr.theme],
	['trace', run_board_theme_trace.theme],
	['flux', run_board_theme_flux.theme],
	['codec', run_board_theme_codec.theme],
	['nixie', run_board_theme_nixie.theme],
	['skynet', run_board_theme_skynet.theme],
	['magi', run_board_theme_magi.theme],
	['deviant', run_board_theme_deviant.theme],
	['isac', run_board_theme_isac.theme],
	['ghost', run_board_theme_ghost.theme],
])

function factory_of(value: ThemeValue): ThemeFactory | undefined {
	return FACTORIES.get(value)
}

// The opening's sound of the theme value shown: as its theme's intro sounded, none in none.
function opening_sound_of(value: ThemeValue): OpeningSound {
	return run_board_theme_sound.opening_sound_of(value === '' ? undefined : value)
}

// The theme run of a live board launched in `theme` on a terminal of `color_depth`; none without 24-bit
// color (Issue 4-3). A board launched in no theme runs one showing none, so demo mode's `/` reaches it
// too (Issue 4-4).
function run_of(theme: Theme | undefined, color_depth: number): ThemeRun | undefined {
	if (color_depth < run_board_paint.RGB_COLOR_DEPTH) return undefined

	return run_board_theme_run.run_of(theme ?? '', factory_of, opening_sound_of)
}

const run_board_theme_registry = { factory_of, run_of }

export { run_board_theme_registry }
