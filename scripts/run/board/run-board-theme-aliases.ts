import { run_board_theme_defs, type Theme } from './run-board-theme-defs'

// joshuafolkken/kit#8917 (Issue 4-2): the `--theme` aliases as the pages say them, read off
// `THEME_ALIASES` so neither the `run:board` usage (`josh-commands-progress.ts`) nor the pages that copy
// it drift from the values the board reads (`run-board-theme-aliases.test.ts`).

const { THEMES, THEME_ALIASES } = run_board_theme_defs

function code(text: string): string {
	return `\`${text}\``
}

// A value's aliases: `` `bttf` and `backtothefuture` (flux) ``; none for a value with none.
function aliases_of(theme: Theme): string {
	const names = [...THEME_ALIASES]
		.filter(([, value]) => value === theme)
		.map(([alias]) => code(alias))

	return names.length === 0 ? '' : `${names.join(' and ')} (${theme})`
}

// Every value's aliases, in the values' order.
function alias_text(): string {
	return THEMES.map((theme) => aliases_of(theme))
		.filter((text) => text !== '')
		.join(', ')
}

// Every value in code: `` `wopr`, `trace`, … ``.
function value_text(): string {
	return THEMES.map((theme) => code(theme)).join(', ')
}

const run_board_theme_aliases = { alias_text, value_text }

export { run_board_theme_aliases }
