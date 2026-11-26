import { run_board_theme_aliases } from '#scripts/run/board/run-board-theme-aliases'
import { describe, expect, it } from 'vitest'
import { PROGRESS_COMMANDS } from './josh-commands-progress'

describe('PROGRESS_COMMANDS', () => {
	it('carries the usage of `run:board` on its entry', () => {
		expect(PROGRESS_COMMANDS['run:board']?.usage.examples.length).toBeGreaterThan(0)
	})

	// joshuafolkken/kit#8917: the `--theme` values and aliases are read off the theme table.
	it('names every `--theme` value and alias as the theme table holds them', () => {
		const options = JSON.stringify(PROGRESS_COMMANDS['run:board']?.usage)

		expect(options).toContain(run_board_theme_aliases.value_text())
		expect(options).toContain(run_board_theme_aliases.alias_text())
	})
})
