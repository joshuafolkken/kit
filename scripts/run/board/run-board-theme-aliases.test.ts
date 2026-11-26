import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { run_board_theme_aliases } from './run-board-theme-aliases'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8917 (Issue 4-2): the alias list the pages copy is the one the board reads — the
// board page derived from the command map, and the environment page written by hand.

const { alias_text, value_text } = run_board_theme_aliases
const ALIAS_PAGES = ['docs/josh-commands-board.md', 'docs/environment-variables.md']

describe('run_board_theme_aliases.alias_text', () => {
	it('names every alias beside the value it is read as', () => {
		for (const [alias, theme] of run_board_theme_defs.THEME_ALIASES) {
			expect(alias_text()).toMatch(new RegExp(`\`${alias}\`[^(]*\\(${theme}\\)`, 'u'))
		}
	})

	it('joins two aliases of one value with "and"', () => {
		expect(alias_text()).toContain('`bttf` and `backtothefuture` (flux)')
	})

	it.each(ALIAS_PAGES)('is the alias list %s copies', (page) => {
		expect(readFileSync(page, 'utf8')).toContain(alias_text())
	})
})

describe('run_board_theme_aliases.value_text', () => {
	it('names every value in the table order', () => {
		expect(value_text()).toBe(run_board_theme_defs.THEMES.map((theme) => `\`${theme}\``).join(', '))
	})

	it.each(ALIAS_PAGES)('is the value list %s copies', (page) => {
		expect(readFileSync(page, 'utf8')).toContain(value_text())
	})
})
