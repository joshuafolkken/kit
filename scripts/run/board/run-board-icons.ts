import { run_board_option, type OptionSpec } from './run-board-option'
import type { Theme } from './run-board-theme-defs'

// joshuafolkken/kit#8505: how the board draws its icons — `emoji` as they are, `letters` as the
// two-letter capitals of the glyph table, `shapes` as its ASCII shapes (`>>` running, `||` paused).
// `JOSH_BOARD_ICONS` or `--icons` picks one for any theme or none; unset, a board in no theme draws
// emoji and one in any theme draws shapes.

const ICONS = ['emoji', 'letters', 'shapes'] as const

type Icons = (typeof ICONS)[number]

const ICONS_ENV = 'JOSH_BOARD_ICONS'
const ICONS_OPTION: OptionSpec<Icons> = {
	flag: '--icons',
	env: ICONS_ENV,
	noun: 'icons',
	names: ICONS,
}

interface IconsChoice {
	icons: Icons
	argv: Array<string>
}

function default_of(theme: Theme | undefined): Icons {
	return theme === undefined ? 'emoji' : 'shapes'
}

// The icons `--icons` names, else `JOSH_BOARD_ICONS`, else the theme's default, with the arguments
// left; `undefined` for a name no icons have.
function choose(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
	theme: Theme | undefined,
): IconsChoice | undefined {
	const chosen = run_board_option.choose(argv, environment, ICONS_OPTION)

	if (chosen === undefined) return undefined

	return { icons: chosen.name ?? default_of(theme), argv: chosen.argv }
}

function refusal(argv: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): string {
	return run_board_option.refusal(argv, environment, ICONS_OPTION)
}

const run_board_icons = { ICONS, ICONS_ENV, choose, default_of, refusal }

export { run_board_icons }
export type { Icons }
